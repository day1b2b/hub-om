import type { ClientSession } from "mongodb";
import type { CoachManagerMyPageRepository } from "./coachManagerMyPageRepository";
import { groupConfirmedCourses, toMyActiveReservations, type EngagementWithCoach, type MyConfirmedCourseScheduleRow } from "./coachMyPagePresentation";
import { normalizePersonName } from "./myOperations";
import { splitPersonNames } from "./personNames";
import { mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { assertMongo, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";

export const COACH_MANAGER_MY_PAGE_MODELS = ["Coach", "CoachDayReservation", "CoachEngagement", "CoachEngagementSchedule", "TeamUser"] as const;
export async function prepareMongoCoachManagerMyPageStore(options: MongoOperationOptions & { allowShadowWrites: true }) {
  await prepareMongoReadStore(options, COACH_MANAGER_MY_PAGE_MODELS);
}
const coachDto = (row: MongoRow) => ({ id: row.id as string, name: row.name as string });
const engagementDto = (row: MongoRow): EngagementWithCoach["engagement"] => ({
  id: row.id as string, courseName: row.courseName as string, startDate: row.startDate as Date, endDate: row.endDate as Date,
  status: row.status as EngagementWithCoach["engagement"]["status"], rating: row.rating as number | null,
  feedback: row.feedback as string | null, rehire: row.rehire as boolean | null
});

/** Explicit read-only shadow backend. Each method reads its relations and roster in
 * one snapshot; the two independent calls made by the page are not one transaction.
 */
export class MongoCoachManagerMyPageRepository implements CoachManagerMyPageRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoOperationOptions) {
    const store = new MongoOperationStore(options, COACH_MANAGER_MY_PAGE_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoCoachManagerMyPageRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("MANAGER_MY_PAGE_OPEN_FAILED"); }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("MANAGER_MY_PAGE_READ_FAILED"); }
    finally { await session.endSession(); }
  }
  private async reservations(email: string, confirmed: boolean, session: ClientSession) {
    const rows = await this.store.scan("CoachDayReservation", {
      reservedByEmailPiiIndex: mongoRuntimeBlindIndex("CoachDayReservation", "reservedByEmail", email),
      ...(confirmed ? { confirmedEngagementId: { $ne: null } } : { cancelledAt: null })
    }, session);
    assertMongo(rows.every(row => row.reservedByEmail === email), "PRIVATE_EQUALITY_MISMATCH");
    return rows;
  }
  private async coaches(ids: string[], session: ClientSession) {
    return new Map((await this.store.scan("Coach", { _id: { $in: [...new Set(ids)] } }, session)).map(row => [row.id as string, coachDto(row)]));
  }
  async listMyActiveReservations(email: string) {
    if (!email) return [];
    return this.read(async session => {
      const rows = await this.reservations(email, false, session);
      const coaches = await this.coaches(rows.map(row => row.coachId as string), session);
      rows.sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime());
      return toMyActiveReservations(rows.map(row => {
        const coach = coaches.get(row.coachId as string); assertMongo(coach, "MANAGER_MY_PAGE_COACH_NOT_FOUND");
        return { date: row.date as Date, coach };
      }));
    });
  }
  async listMyConfirmedCourses(email: string) {
    if (!email) return [];
    return this.read(async session => {
      const reservations = await this.reservations(email, true, session);
      const linked = new Map((await this.store.scan("CoachEngagement", { _id: { $in: [...new Set(reservations.map(row => row.confirmedEngagementId as string))] } }, session)).map(row => [row.id as string, row]));
      // Mirrors resolveOmNameByEmail/listTeamUsers PG semantics, within this
      // snapshot instead of invoking a second backend or a local-file fallback.
      const targetEmail = email.trim().toLowerCase();
      const users = targetEmail ? await this.store.scan("TeamUser", {}, session) : [];
      users.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      const name = users.find(row => (row.email as string).trim().toLowerCase() === targetEmail)?.name as string | undefined;
      const candidates = name ? (await this.store.scan("CoachEngagement", {}, session)).filter(row =>
        typeof row.hiredByText === "string" && row.hiredByText.includes(name)
        && splitPersonNames(row.hiredByText).some(person => normalizePersonName(person) === normalizePersonName(name))) : [];
      const coaches = await this.coaches([...reservations, ...candidates].map(row => row.coachId as string), session);
      const byId = new Map<string, EngagementWithCoach>();
      for (const row of reservations) {
        const engagement = linked.get(row.confirmedEngagementId as string);
        assertMongo(engagement, "MANAGER_MY_PAGE_ENGAGEMENT_NOT_FOUND");
        const coach = coaches.get(row.coachId as string); assertMongo(coach, "MANAGER_MY_PAGE_COACH_NOT_FOUND");
        byId.set(engagement.id as string, { coach, engagement: engagementDto(engagement) });
      }
      for (const row of candidates) {
        if (byId.has(row.id as string)) continue;
        const coach = coaches.get(row.coachId as string); assertMongo(coach, "MANAGER_MY_PAGE_COACH_NOT_FOUND");
        byId.set(row.id as string, { coach, engagement: engagementDto(row) });
      }
      const slots = byId.size ? await this.store.scan("CoachEngagementSchedule", { engagementId: { $in: [...byId.keys()] }, cancelledAt: null }, session) : [];
      slots.sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime());
      return groupConfirmedCourses(byId.values(), slots.map((row): MyConfirmedCourseScheduleRow => ({ engagementId: row.engagementId as string, date: row.date as Date, startTime: row.startTime as string, endTime: row.endTime as string })));
    });
  }
}
