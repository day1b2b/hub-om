import type { ClientSession } from "mongodb";
import type { CoachOwnProfile, CoachTokenRepository, PublicCoachTokenContext } from "./coachTokenRepository";
import { MongoOperationStore, MongoOperationError, assertMongo, type MongoOperationOptions } from "./mongoOperationStore";
import { prepareMongoReadStore, assertMongoReadStoreReady } from "./mongoReadStore";

export const COACH_TOKEN_MODELS = ["Coach", "CoachField", "CoachFieldMaster", "CoachCurriculum", "CoachCurriculumMaster", "CoachdbArchiveRow", "CoachdbArchiveSnapshot"] as const;
export async function prepareMongoCoachTokenStore(options: MongoOperationOptions & { allowShadowWrites: true }) { await prepareMongoReadStore(options, COACH_TOKEN_MODELS); }

/** Shadow-only authenticated lookups. Neither opening nor reading writes data or prepares schema. */
export class MongoCoachTokenRepository implements CoachTokenRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoOperationOptions): Promise<MongoCoachTokenRepository> {
    const store = new MongoOperationStore(options, COACH_TOKEN_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo(hello.setName && hello.logicalSessionTimeoutMinutes != null, "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoCoachTokenRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_TOKEN_OPEN_FAILED");
    }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    // Include session creation/disposal in the error boundary: driver messages must not leak tokens.
    try {
      const session = this.store.client.startSession();
      try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
      finally { await session.endSession(); }
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_TOKEN_READ_FAILED");
    }
  }
  private async lookup(token: string, session: ClientSession): Promise<PublicCoachTokenContext | null> {
    const rows = await this.store.findPrivateEqual("Coach", "accessToken", token, session);
    assertMongo(rows.length <= 1, "COACH_TOKEN_NOT_UNIQUE");
    const row = rows[0];
    if (!row || row.deletedAt !== null || !row.accessToken) return null;
    // findPrivateEqual verifies decoded equality in addition to the stored HMAC predicate.
    assertMongo(row.accessToken === token, "COACH_TOKEN_MISMATCH");
    return { id: row.id as string, sourceCoachId: row.sourceCoachId as string, name: row.name as string, workType: row.workType as string | null, status: row.status as PublicCoachTokenContext["status"], accessToken: row.accessToken as string };
  }
  async findByToken(token: string): Promise<PublicCoachTokenContext | null> {
    if (!token) return null;
    return this.read(session => this.lookup(token, session));
  }
  private async tags(coachId: string, curriculum: boolean, session: ClientSession): Promise<{ id: string; name: string }[]> {
    const model = curriculum ? "CoachCurriculum" : "CoachField";
    const links = await this.store.scan(model, { coachId }, session);
    const masters = await this.store.scan(`${model}Master`, { _id: { $in: links.map(link => link.tagId as string) } }, session);
    const byId = new Map(masters.map(master => [master.id, master]));
    return links.map(link => {
      const master = byId.get(link.tagId); assertMongo(master, "COACH_RELATION_MISSING");
      return { id: master.id as string, name: master.name as string };
    });
  }
  private async availability(sourceCoachId: string, session: ClientSession): Promise<string | null> {
    const archive = (await this.store.findPrivateEqual("CoachdbArchiveRow", "rowKey", sourceCoachId, session)).filter(row => row.tableSchema === "public" && row.tableName === "coaches");
    if (!archive.length) return null;
    const snapshots = await this.store.scan("CoachdbArchiveSnapshot", { _id: { $in: archive.map(row => row.snapshotId as string) } }, session);
    const byId = new Map(snapshots.map(row => [row.id, row]));
    for (const row of archive) assertMongo(byId.has(row.snapshotId), "COACH_RELATION_MISSING");
    const latest = archive.filter(row => byId.get(row.snapshotId)!.status === "completed").sort((a, b) => (byId.get(b.snapshotId)!.startedAt as Date).getTime() - (byId.get(a.snapshotId)!.startedAt as Date).getTime())[0];
    const data = latest?.rowData;
    const value = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).availability_detail : null;
    return typeof value === "string" && value.trim() ? value : null;
  }
  async getOwnProfile(token: string): Promise<CoachOwnProfile | null> {
    if (!token) return null;
    return this.read(async session => {
      const coach = await this.lookup(token, session);
      if (!coach) return null;
      // Sequential operations keep each driver's session single-use at a time.
      const fields = await this.tags(coach.id, false, session), curriculums = await this.tags(coach.id, true, session), availabilityDetail = await this.availability(coach.sourceCoachId, session);
      return { id: coach.id, name: coach.name, status: coach.status.toLowerCase(), workType: coach.workType, availabilityDetail, fields, curriculums };
    });
  }
}
