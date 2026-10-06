import type { ClientSession, Document } from "mongodb";
import type { CoachDataVerificationRepository, CoachImportSummary, CoachArchiveSummary, VerificationCount } from "./coachDataVerificationRepository";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { assertMongo, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";

export const COACH_DATA_VERIFICATION_MODELS = ["Coach", "CoachPrivateProfile", "CoachEngagement", "CoachSchedule",
  "CoachEngagementSchedule", "CoachImportRun", "CoachdbArchiveSnapshot", "CoachdbArchiveRow"] as const;
type Options = MongoOperationOptions;
const tables = ["coaches", "coach_private_profiles", "engagements", "coach_schedules", "engagement_schedules"];
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function dateOrNull(value: unknown): value is Date | null { return value === null || value instanceof Date && Number.isFinite(value.getTime()); }
function importSummary(row: Document | null): CoachImportSummary | null {
  if (!row) return null;
  assertMongo(typeof row.mode === "string" && typeof row.status === "string" && dateOrNull(row.finishedAt)
    && [row.coachCount, row.engagementCount, row.scheduleCount, row.matchedOperationCount, row.errorCount].every(integer), "INVALID_IMPORT_SUMMARY");
  return { mode: row.mode, status: row.status, coachCount: row.coachCount, engagementCount: row.engagementCount,
    scheduleCount: row.scheduleCount, matchedOperationCount: row.matchedOperationCount, errorCount: row.errorCount, finishedAt: row.finishedAt };
}
function archiveSummary(row: Document | null): CoachArchiveSummary | null {
  if (!row) return null;
  assertMongo(typeof row._id === "string" && typeof row.status === "string" && integer(row.tableCount) && integer(row.rowCount)
    && dateOrNull(row.finishedAt), "INVALID_ARCHIVE_SUMMARY");
  return { id: row._id, tableCount: row.tableCount, rowCount: row.rowCount, status: row.status, finishedAt: row.finishedAt };
}
export async function prepareMongoCoachDataVerificationStore(options: Options & { allowShadowWrites: true }) {
  await prepareMongoReadStore(options, COACH_DATA_VERIFICATION_MODELS);
}
export class MongoCoachDataVerificationRepository implements CoachDataVerificationRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    try { const store = new MongoOperationStore(options, COACH_DATA_VERIFICATION_MODELS); await assertMongoReadStoreReady(store);
      const hello = await store.db.command({ hello: 1 }); assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid")
        && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED"); return new MongoCoachDataVerificationRepository(store); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_DATA_VERIFICATION_OPEN_FAILED"); }
  }
  private count(model: string, filter: Document, session: ClientSession) { return this.store.collection(model).countDocuments(filter, { session, maxTimeMS: 30_000 }); }
  async readReport() {
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(async () => {
        // The driver forbids parallel operations on one transaction/session.
        const coachesTotal = await this.count("Coach", {}, session), coachesVisible = await this.count("Coach", { deletedAt: null }, session);
        const coachesDeleted = await this.count("Coach", { deletedAt: { $ne: null } }, session), privateProfiles = await this.count("CoachPrivateProfile", {}, session);
        const engagements = await this.count("CoachEngagement", {}, session), schedules = await this.count("CoachSchedule", {}, session);
        const engagementSchedules = await this.count("CoachEngagementSchedule", {}, session);
        const matchedEngagements = await this.count("CoachEngagement", { operationSessionId: { $ne: null } }, session);
        const unmatchedEngagements = await this.count("CoachEngagement", { operationSessionId: null }, session);
        const importRow = await this.store.collection("CoachImportRun").findOne({}, { session, sort: { startedAt: -1, _id: -1 }, projection: { mode: 1, status: 1, coachCount: 1,
          engagementCount: 1, scheduleCount: 1, matchedOperationCount: 1, errorCount: 1, finishedAt: 1 }, maxTimeMS: 30_000 });
        const archiveRow = await this.store.collection("CoachdbArchiveSnapshot").findOne({}, { session, sort: { startedAt: -1, _id: -1 }, projection: { tableCount: 1, rowCount: 1, status: 1, finishedAt: 1 }, maxTimeMS: 30_000 });
        const latestArchive = archiveSummary(archiveRow), archiveCounts: VerificationCount[] = [];
        if (latestArchive) {
          const grouped = await this.store.collection("CoachdbArchiveRow").aggregate([
            { $match: { snapshotId: latestArchive.id, tableName: { $in: tables } } }, { $group: { _id: "$tableName", count: { $sum: 1 } } }, { $sort: { _id: 1 } },
          ], { session, maxTimeMS: 30_000 }).toArray();
          for (const row of grouped) { assertMongo(typeof row._id === "string" && tables.includes(row._id) && integer(row.count), "INVALID_ARCHIVE_COUNT"); archiveCounts.push({ label: row._id, count: row.count }); }
        }
        return { serviceCounts: [
          ["coaches_total", coachesTotal], ["coaches_visible", coachesVisible], ["coaches_deleted", coachesDeleted], ["private_profiles", privateProfiles],
          ["engagements", engagements], ["schedules", schedules], ["engagement_schedules", engagementSchedules],
          ["matched_engagements", matchedEngagements], ["unmatched_engagements", unmatchedEngagements],
        ].map(([label, count]) => ({ label: String(label), count: Number(count) })), latestImport: importSummary(importRow), latestArchive, archiveCounts };
      }, { readConcern: { level: "snapshot" }, readPreference: "primary", maxCommitTimeMS: 5_000, timeoutMS: 30_000 });
    } catch { throw new MongoOperationError("COACH_DATA_VERIFICATION_FAILED"); }
    finally { await session.endSession(); }
  }
}
