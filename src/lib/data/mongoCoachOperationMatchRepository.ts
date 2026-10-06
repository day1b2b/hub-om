import { MongoServerError, type ClientSession } from "mongodb";
import type { CoachOperationMatchRepository, CoachOperationMatchSnapshot } from "./coachOperationMatchRepository";
import { assertMongoCoachCatalogGuardReady, lockMongoCoachCatalog, prepareMongoCoachCatalogGuard } from "./mongoCoachCatalogGuard";
import { assertMongo, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";

export const COACH_OPERATION_MATCH_MODELS = ["Company", "Course", "OperationSession", "Coach", "CoachEngagement", "CoachEngagementSchedule"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

export async function prepareMongoCoachOperationMatchStore(options: Options): Promise<void> {
  await prepareMongoReadStore(options, COACH_OPERATION_MATCH_MODELS);
  await prepareMongoCoachCatalogGuard(new MongoOperationStore(options, COACH_OPERATION_MATCH_MODELS), options.allowShadowWrites);
}

export class MongoCoachOperationMatchRepository implements CoachOperationMatchRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: Options): Promise<MongoCoachOperationMatchRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, COACH_OPERATION_MATCH_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes != null, "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachCatalogGuardReady(store);
      return new MongoCoachOperationMatchRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_OPERATION_MATCH_OPEN_FAILED");
    }
  }

  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(() => work(session), {
          readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000
        });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError) throw error;
        throw new MongoOperationError("COACH_OPERATION_MATCH_TRANSACTION_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_OPERATION_MATCH_RETRY_LIMIT");
  }

  async readSnapshot(): Promise<CoachOperationMatchSnapshot> {
    return this.transaction(async session => {
      // The Node driver does not support parallel operations in one transaction.
      const operations = await this.store.scan("OperationSession", { deletedAt: null }, session);
      const companies = await this.store.scan("Company", {}, session);
      const courses = await this.store.scan("Course", {}, session);
      const coaches = await this.store.scan("Coach", {}, session);
      const engagements = await this.store.scan("CoachEngagement", {}, session);
      const schedules = await this.store.scan("CoachEngagementSchedule", { cancelledAt: null }, session);
      const companyById = new Map(companies.map(row => [row.id as string, row]));
      const courseById = new Map(courses.map(row => [row.id as string, row]));
      const coachById = new Map(coaches.map(row => [row.id as string, row]));
      const schedulesByEngagement = new Map<string, MongoRow[]>();
      for (const schedule of schedules) {
        const id = schedule.engagementId as string;
        schedulesByEngagement.set(id, [...(schedulesByEngagement.get(id) ?? []), schedule]);
      }
      const unmatched = engagements.filter(row => row.operationSessionId === null).sort((left, right) =>
        (right.startDate as Date).getTime() - (left.startDate as Date).getTime()
        || String(left.courseName).localeCompare(String(right.courseName)));
      return {
        counts: { total: engagements.length, matched: engagements.length - unmatched.length, unmatched: unmatched.length },
        candidates: operations.map(row => {
          const course = courseById.get(row.courseRecordId as string);
          assertMongo(course, "COACH_OPERATION_MATCH_RELATION_MISSING");
          const company = companyById.get(course.companyId as string);
          assertMongo(company, "COACH_OPERATION_MATCH_RELATION_MISSING");
          return { id: row.id as string, operationId: row.operationId as string, companyName: company.name as string,
            courseName: course.name as string, startDate: dateOnly(row.startDate as Date), endDate: dateOnly(row.endDate as Date),
            timeText: row.timeText as string | null, coachText: row.coachText as string | null, instructorsText: row.instructorsText as string | null };
        }),
        engagements: unmatched.map(row => {
          const coach = coachById.get(row.coachId as string);
          assertMongo(coach, "COACH_OPERATION_MATCH_RELATION_MISSING");
          const related = schedulesByEngagement.get(row.id as string) ?? [];
          return { id: row.id as string, courseName: row.courseName as string, coachName: coach.name as string,
            startDate: row.startDate as Date, endDate: row.endDate as Date, startTime: row.startTime as string | null, endTime: row.endTime as string | null,
            scheduleDates: [...new Set(related.map(item => dateOnly(item.date as Date)))].sort(),
            scheduleTimes: [...new Map(related.map(item => [`${item.startTime}-${item.endTime}`, { startTime: item.startTime as string, endTime: item.endTime as string }])).values()] };
        })
      };
    });
  }

  async applyMatches(matches: ReadonlyArray<{ engagementId: string; operationSessionId: string }>): Promise<number> {
    if (!matches.length) return 0;
    return this.transaction(async session => {
      await lockMongoCoachCatalog(this.store, session);
      let updated = 0;
      for (const match of matches) {
        const operation = await this.store.one("OperationSession", { _id: match.operationSessionId, deletedAt: null }, session);
        if (!operation) continue;
        const result = await this.store.collection("CoachEngagement").updateOne(
          { _id: match.engagementId, operationSessionId: null }, { $set: { operationSessionId: match.operationSessionId } }, { session }
        );
        updated += result.modifiedCount;
      }
      return updated;
    });
  }
}
