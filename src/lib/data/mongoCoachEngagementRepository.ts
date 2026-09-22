import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import { activityContext } from "../activity/context";
import { manualSourceId, weekdayScheduleEntries } from "../coaches/engagementApi";
import { toCoachEngagementRecord, toCoachEngagementListItem, type CoachEngagementRepository, type CoachEngagementRow, type CreateCoachEngagementInput, type UpdateCoachEngagementInput, type CoachReviewCommand, type CoachEngagementAuthor, type CoachReviewResult } from "./coachEngagementRepository";
import { MongoOperationStore, MongoOperationError, assertMongo, completeMongoRow, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongoCoachSchedulingGuardReady, prepareMongoCoachSchedulingGuard, lockMongoCoachScheduling } from "./mongoCoachSchedulingGuard";

export const COACH_ENGAGEMENT_MODELS = ["Coach", "CoachEngagement", "CoachEngagementSchedule", "CoachDayReservation", "CoachContentEntry", "ActivityChange"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
const logical = (row: MongoRow) => row as unknown as CoachEngagementRow;

export async function prepareMongoCoachEngagementStore(options: Options): Promise<void> {
  await prepareMongoReadStore(options, COACH_ENGAGEMENT_MODELS);
  await prepareMongoCoachSchedulingGuard(new MongoOperationStore(options, COACH_ENGAGEMENT_MODELS), options.allowShadowWrites);
}
/** Explicit shadow boundary; external sheet writers remain a separate migration gate. */
export class MongoCoachEngagementRepository implements CoachEngagementRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options): Promise<MongoCoachEngagementRepository> {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_ENGAGEMENT_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes != null, "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      return new MongoCoachEngagementRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_ENGAGEMENT_OPEN_FAILED"); }
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 }); }
      catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError) throw error;
        throw new MongoOperationError("COACH_ENGAGEMENT_WRITE_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_ENGAGEMENT_RETRY_LIMIT");
  }
  private async audit(model: string, before: MongoRow | null, after: MongoRow | null, session: ClientSession) {
    const row = operationAuditRow(model, before, after);
    if (row) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", row), { session });
  }
  private async write(model: string, fields: MongoRow, before: MongoRow | null, session: ClientSession): Promise<MongoRow> {
    const row = completeMongoRow(model, fields), document = encodeMongoRuntimeDocument(model, row);
    if (before) {
      const result = await this.store.collection(model).replaceOne({ _id: document._id }, document, { session });
      assertMongo(result.matchedCount === 1, "COACH_ENGAGEMENT_ROW_DISAPPEARED");
    } else await this.store.collection(model).insertOne(document, { session });
    await this.audit(model, before, row, session);
    return row;
  }
  private requireActivity() { assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED"); }
  private async lockedEngagement(id: string, session: ClientSession): Promise<MongoRow | null> {
    // ID lookup is needed to learn the guard key. If the guard advanced since this
    // snapshot, its real write conflicts and the entire callback rereads the ID.
    const initial = await this.store.one("CoachEngagement", { _id: id }, session);
    if (!initial) return null;
    await lockMongoCoachScheduling(this.store, initial.coachId as string, session);
    const current = await this.store.one("CoachEngagement", { _id: id }, session);
    assertMongo(current && current.coachId === initial.coachId, "COACH_ENGAGEMENT_ROW_DISAPPEARED");
    return current;
  }
  async listForCoach(coachId: string) {
    coachId = coachId.toLowerCase();
    return this.transaction(async session => {
      if (!await this.store.one("Coach", { _id: coachId, deletedAt: null }, session)) return null;
      return (await this.store.scan("CoachEngagement", { coachId }, session))
        .sort((a, b) => (b.startDate as Date).getTime() - (a.startDate as Date).getTime())
        .map(row => toCoachEngagementListItem(logical(row)));
    });
  }
  /** Preserve legacy status-independent regeneration, including CANCELLED. */
  private async regenerate(row: MongoRow, session: ClientSession): Promise<void> {
    const engagementId = row.id as string, coachId = row.coachId as string;
    const previous = await this.store.scan("CoachEngagementSchedule", { engagementId }, session);
    await this.store.collection("CoachEngagementSchedule").deleteMany({ engagementId }, { session });
    for (const slot of previous) await this.audit("CoachEngagementSchedule", slot, null, session);
    const slots = weekdayScheduleEntries(row.startDate as Date, row.endDate as Date, row.startTime as string | null, row.endTime as string | null);
    for (const slot of slots) {
      await this.write("CoachEngagementSchedule", { id: randomUUID(), engagementId, coachId,
        sourceEngagementScheduleId: `hub:${engagementId}:${slot.date.toISOString().slice(0, 10)}`, ...slot }, null, session);
    }
    if (!slots.length) return;
    // The guard precedes this predicate, including when it finds no reservations.
    // New reservations after this transaction are permitted by the existing UI contract.
    const reservations = await this.store.scan("CoachDayReservation", { coachId, date: { $in: slots.map(slot => slot.date) }, cancelledAt: null }, session);
    const now = new Date();
    for (const reservation of reservations) {
      await this.write("CoachDayReservation", { ...reservation, cancelledAt: now, confirmedEngagementId: engagementId }, reservation, session);
    }
  }
  async createForCoach(coachId: string, input: CreateCoachEngagementInput) {
    this.requireActivity(); coachId = coachId.toLowerCase();
    return this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      if (!await this.store.one("Coach", { _id: coachId, deletedAt: null }, session)) return null;
      const row = await this.write("CoachEngagement", { id: randomUUID(), sourceEngagementId: manualSourceId(), coachId,
        source: "MANUAL", ...input, createdAt: new Date() }, null, session);
      await this.regenerate(row, session);
      return toCoachEngagementRecord(logical(row));
    });
  }
  async update(engagementId: string, input: UpdateCoachEngagementInput) {
    this.requireActivity(); engagementId = engagementId.toLowerCase();
    return this.transaction(async session => {
      const previous = await this.lockedEngagement(engagementId, session);
      if (!previous) return null;
      const patch = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && (!(key === "courseName" || key === "startDate" || key === "endDate") || value !== null)));
      const row = await this.write("CoachEngagement", { ...previous, ...patch }, previous, session);
      if (input.startDate !== undefined || input.endDate !== undefined || input.startTime !== undefined || input.endTime !== undefined) await this.regenerate(row, session);
      return toCoachEngagementRecord(logical(row));
    });
  }
  async updateReview(engagementId: string, command: CoachReviewCommand, author: CoachEngagementAuthor): Promise<CoachReviewResult> {
    this.requireActivity(); engagementId = engagementId.toLowerCase();
    return this.transaction(async session => {
      const previous = await this.lockedEngagement(engagementId, session);
      assertMongo(previous, "COACH_ENGAGEMENT_NOT_FOUND");
      let patch: MongoRow, summary: string | null = null;
      if (command.action === "toggleFlag") {
        patch = { reviewFlaggedAt: previous.reviewFlaggedAt ? null : new Date() };
        summary = patch.reviewFlaggedAt ? "리뷰 경고 설정" : "리뷰 경고 해제";
      } else if (command.action === "deleteReview") {
        patch = { rating: null, feedback: null }; summary = "리뷰 삭제";
      } else {
        patch = Object.fromEntries(Object.entries(command).filter(([key, value]) => key !== "action" && value !== undefined));
        if (command.rating !== undefined || command.feedback !== undefined) summary = "리뷰 수정";
      }
      const row = await this.write("CoachEngagement", { ...previous, ...patch }, previous, session);
      if (summary) {
        const now = new Date();
        await this.write("CoachContentEntry", { id: randomUUID(), coachId: row.coachId, kind: "EDIT_HISTORY", content: summary,
          authorEmail: author.email, authorName: author.name, sourceField: `coach_engagements.review:${engagementId}`, createdAt: now, updatedAt: now }, null, session);
      }
      const result = toCoachEngagementRecord(logical(row));
      return command.action === "edit" ? { id: result.id, coachId: result.coachId, rating: result.rating, feedback: result.feedback, rehire: result.rehire } : result;
    });
  }
}
