import type { ClientSession } from "mongodb";
import type { CoachManagementRepository, CoachManagementQuery, CoachManagementDetail, CoachManagementSummary, CoachManagementTag, CoachManagementAuthor } from "./coachManagementRepository";
import { MongoCoachWriteRepository, COACH_WRITE_MODELS, type MongoCoachWriteOptions } from "./mongoCoachWriteRepository";
import { MongoOperationStore, assertMongo, MongoOperationError, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";

export const COACH_MANAGEMENT_MODELS = [...COACH_WRITE_MODELS, "CoachEngagement", "CoachSchedule"] as const;
export async function prepareMongoCoachManagementStore(options: MongoCoachWriteOptions) { await prepareMongoReadStore(options, COACH_MANAGEMENT_MODELS); }
const STATUS_ORDER = ["PENDING", "ACTIVE", "INACTIVE"];
const date = (value: unknown) => (value as Date).toISOString().slice(0, 10);
const nullable = (row: MongoRow, key: string) => row[key] as string | null;

/** Management API adapter; no archive fallback or schedule-dashboard DTOs. */
export class MongoCoachManagementRepository implements CoachManagementRepository {
  private readonly store: MongoOperationStore;
  private readonly writes: MongoCoachWriteRepository;
  private constructor(store: MongoOperationStore, writes: MongoCoachWriteRepository) { this.store = store; this.writes = writes; }
  static async open(options: MongoCoachWriteOptions) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_MANAGEMENT_MODELS);
    try {
      await assertMongoReadStoreReady(store);
      return new MongoCoachManagementRepository(store, await MongoCoachWriteRepository.open(options));
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_MANAGEMENT_OPEN_FAILED");
    }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_MANAGEMENT_READ_FAILED"); }
    finally { await session.endSession(); }
  }
  private async tags(ids: string[], curriculum: boolean, session: ClientSession): Promise<Map<string, CoachManagementTag[]>> {
    const model = curriculum ? "CoachCurriculum" : "CoachField";
    const links = await this.store.scan(model, { coachId: { $in: ids } }, session);
    const masters = await this.store.scan(`${model}Master`, { _id: { $in: [...new Set(links.map(row => row.tagId as string))] } }, session);
    const byId = new Map(masters.map(row => [row.id, { id: row.id as string, name: row.name as string }]));
    const result = new Map<string, CoachManagementTag[]>();
    for (const row of links) {
      const tag = byId.get(row.tagId); assertMongo(tag, "COACH_RELATION_MISSING");
      result.set(row.coachId as string, [...(result.get(row.coachId as string) ?? []), tag]);
    }
    return result;
  }
  async listCoaches(query: CoachManagementQuery) {
    assertMongo(Number.isInteger(query.page) && query.page >= 1 && Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 100, "INVALID_COACH_PAGINATION");
    return this.read(async session => {
      const status = ["active", "inactive", "pending"].includes(query.status ?? "") ? query.status!.toUpperCase() : null;
      let rows = (await this.store.scan("Coach", { deletedAt: null }, session)).filter(row => status ? row.status === status : row.status !== "PENDING");
      const search = query.search?.toLowerCase();
      if (search) rows = rows.filter(row => String(row.name).toLowerCase().includes(search) || String(row.workType ?? "").toLowerCase().includes(search));
      const fields = await this.tags(rows.map(row => row.id as string), false, session);
      if (query.field) rows = rows.filter(row => fields.get(row.id as string)?.some(tag => tag.name === query.field));
      rows.sort((a, b) => STATUS_ORDER.indexOf(a.status as string) - STATUS_ORDER.indexOf(b.status as string) || String(a.normalizedName).localeCompare(String(b.normalizedName), "ko"));
      const total = rows.length;
      rows = rows.slice((query.page - 1) * query.limit, query.page * query.limit);
      const ids = rows.map(row => row.id as string), curriculums = await this.tags(ids, true, session);
      const engagements = await this.store.scan("CoachEngagement", { coachId: { $in: ids } }, session);
      const coaches: CoachManagementSummary[] = rows.map(row => {
        const all = engagements.filter(item => item.coachId === row.id).sort((a, b) => (b.endDate as Date).getTime() - (a.endDate as Date).getTime());
        return { id: row.id as string, name: row.name as string, workType: nullable(row, "workType"), status: String(row.status).toLowerCase(), isActive: row.isActive as boolean,
          fields: fields.get(row.id as string) ?? [], curriculums: curriculums.get(row.id as string) ?? [], engagementCount: all.length,
          latestEngagement: all[0] ? { courseName: all[0].courseName as string, endDate: date(all[0].endDate) } : null };
      });
      return { coaches, total };
    });
  }
  async getCoach(id: string): Promise<CoachManagementDetail | null> {
    return this.read(async session => {
      const row = await this.store.one("Coach", { _id: id, deletedAt: null }, session);
      if (!row) return null;
      const fields = await this.tags([id], false, session), curriculums = await this.tags([id], true, session);
      const engagements = await this.store.scan("CoachEngagement", { coachId: id }, session), schedules = await this.store.scan("CoachSchedule", { coachId: id }, session);
      return { id, name: row.name as string, workType: nullable(row, "workType"), status: String(row.status).toLowerCase(), statusNote: nullable(row, "statusNote"), returnDate: row.returnDate ? date(row.returnDate) : null,
        selfNote: nullable(row, "selfNote"), portfolioUrl: nullable(row, "portfolioUrl"), availabilityDetail: nullable(row, "availabilityDetail"), managerNote: nullable(row, "managerNote"), dxTag: nullable(row, "dxTag"), isActive: row.isActive as boolean,
        fields: fields.get(id) ?? [], curriculums: curriculums.get(id) ?? [], engagementCount: engagements.length, scheduleCount: schedules.length };
    });
  }
  createCoach(body: Record<string, unknown>) { return this.writes.createCoach(body); }
  updateCoach(id: string, body: Record<string, unknown>, author: CoachManagementAuthor) { return this.writes.updateCoach(id, body, author); }
  updateCoachStatus(id: string, status: unknown) { return this.writes.updateCoachStatus(id, status); }
  deleteCoach(id: string, deletedBy: string | null) { return this.writes.deleteCoach(id, deletedBy); }
}
