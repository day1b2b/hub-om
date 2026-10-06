import { prepareMongoCoachCatalogGuard, assertMongoCoachCatalogGuardReady, lockMongoCoachCatalog } from "./mongoCoachCatalogGuard";
import { prepareMongoCoachSchedulingGuard, assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling } from "./mongoCoachSchedulingGuard";
import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import { generateCoachAccessToken, normalizeCoachName } from "../coaches/accessToken";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { operationAuditRow } from "./mongoOperationAudit";

export const COACH_WRITE_MODELS = ["Coach", "CoachPrivateProfile", "CoachField", "CoachFieldMaster", "CoachCurriculum", "CoachCurriculumMaster", "CoachContentEntry", "ActivityChange"] as const;
export type MongoCoachWriteOptions = MongoOperationOptions & { allowShadowWrites: true };
export interface CoachWriteAuthor { email: string; name: string }
const PROFILE_FIELDS = ["name", "workType", "statusNote", "returnDate", "selfNote", "portfolioUrl", "availabilityDetail", "managerNote", "dxTag", "isActive", "fields", "curriculums"] as const;
const TEXT_FIELDS = ["workType", "statusNote", "selfNote", "portfolioUrl", "availabilityDetail", "managerNote", "dxTag"] as const;
const PRIVATE_FIELDS = ["employeeId", "phone", "email", "birthDate", "affiliation"] as const;
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function list(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.map(text).filter((item): item is string => item !== null))] : []; }
function date(value: unknown): Date | null {
  const valueText = text(value);
  if (!valueText || !/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return null;
  const parsed = new Date(`${valueText}T00:00:00.000Z`);
  assertMongo(Number.isFinite(parsed.getTime()), "INVALID_COACH_DATE");
  return parsed;
}
function status(value: unknown, pending = true): string | null {
  return value === "active" ? "ACTIVE" : value === "inactive" ? "INACTIVE" : pending && value === "pending" ? "PENDING" : null;
}
function dto(row: MongoRow): { id: string; name: string } { return { id: row.id as string, name: row.name as string }; }

/** Explicit schema/index setup for disposable shadow namespaces only. */
export async function prepareMongoCoachWriteStore(options: MongoCoachWriteOptions): Promise<void> {
  await prepareMongoReadStore(options, COACH_WRITE_MODELS);
  const store = new MongoOperationStore(options, COACH_WRITE_MODELS);
  await prepareMongoCoachCatalogGuard(store, options.allowShadowWrites);
  await prepareMongoCoachSchedulingGuard(store, options.allowShadowWrites);
}

/** Matches the authenticated coach management POST/PUT/PATCH/DELETE payloads.
 * Authentication, authorization and request activity remain the route's responsibility.
 * This repository is deliberately not wired to production routes or factories.
 */
export class MongoCoachWriteRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoCoachWriteOptions): Promise<MongoCoachWriteRepository> {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_WRITE_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo(hello.setName && hello.logicalSessionTimeoutMinutes != null, "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachCatalogGuardReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      return new MongoCoachWriteRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_WRITE_OPEN_FAILED");
    }
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    // Unique tag-name races can surface as 11000 without a transient label.
    // Restart the complete transaction so it observes the winning master tag.
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => { await lockMongoCoachCatalog(this.store, session); return work(session); }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError) throw error;
        // Driver/codec failures may contain private values; never expose them to callers.
        throw new MongoOperationError("COACH_WRITE_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_WRITE_RETRY_LIMIT");
  }
  private async write(model: string, fields: MongoRow, exists: boolean, session: ClientSession): Promise<MongoRow> {
    const row = completeMongoRow(model, fields), document = encodeMongoRuntimeDocument(model, row);
    const previous = exists ? await this.store.one(model, { _id: document._id }, session) : null;
    if (exists) {
      const result = await this.store.collection(model).replaceOne({ _id: document._id }, document, { session });
      assertMongo(result.matchedCount === 1, "COACH_ROW_DISAPPEARED");
    } else await this.store.collection(model).insertOne(document, { session });
    const audit = operationAuditRow(model, previous, row);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    return row;
  }
  private async existing(coachId: string, session: ClientSession): Promise<MongoRow> {
    const row = await this.store.one("Coach", { _id: coachId, deletedAt: null }, session);
    assertMongo(row, "COACH_NOT_FOUND");
    return row;
  }
  private async tags(coachId: string, type: "fields" | "curriculums", names: string[], session: ClientSession): Promise<void> {
    const link = type === "fields" ? "CoachField" : "CoachCurriculum", master = `${link}Master`;
    const previousLinks = await this.store.scan(link, { coachId }, session);
    await this.store.collection(link).deleteMany({ coachId }, { session });
    for (const previous of previousLinks) {
      const audit = operationAuditRow(link, previous, null);
      if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    }
    for (const name of names) {
      let tag = await this.store.one(master, { name }, session);
      if (!tag) tag = await this.write(master, { id: randomUUID(), name }, false, session);
      await this.write(link, { coachId, tagId: tag.id }, false, session);
    }
  }
  async createCoach(body: Record<string, unknown>): Promise<{ id: string; name: string }> {
    const name = text(body.name);
    assertMongo(name, "COACH_NAME_REQUIRED");
    return this.transaction(async session => {
      const now = new Date(), id = randomUUID();
      await lockMongoCoachScheduling(this.store, id, session);
      const coach = await this.write("Coach", {
        id, sourceCoachId: `hub:${randomUUID()}`, accessToken: generateCoachAccessToken(), name, normalizedName: normalizeCoachName(name),
        ...Object.fromEntries(TEXT_FIELDS.filter(key => key !== "dxTag").map(key => [key, text(body[key])])),
        status: status(body.status) ?? "ACTIVE", returnDate: date(body.returnDate), isActive: true, createdAt: now, updatedAt: now
      }, false, session);
      await this.write("CoachPrivateProfile", { coachId: coach.id, employeeId: null, phone: text(body.phone), email: text(body.email), birthDate: date(body.birthDate), affiliation: text(body.affiliation), createdAt: now, updatedAt: now }, false, session);
      await this.tags(coach.id as string, "fields", list(body.fields), session);
      await this.tags(coach.id as string, "curriculums", list(body.curriculums), session);
      return dto(coach);
    });
  }
  async updateCoach(coachId: string, body: Record<string, unknown>, author: CoachWriteAuthor): Promise<{ id: string; name: string }> {
    return this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      const previous = await this.existing(coachId, session), now = new Date(), patch: MongoRow = {};
      if (body.name !== undefined) {
        const name = text(body.name); assertMongo(name, "COACH_NAME_REQUIRED");
        patch.name = name; patch.normalizedName = normalizeCoachName(name);
      }
      for (const key of TEXT_FIELDS) if (body[key] !== undefined) patch[key] = text(body[key]);
      if (body.status !== undefined) patch.status = status(body.status) ?? "ACTIVE";
      if (body.returnDate !== undefined) patch.returnDate = date(body.returnDate);
      if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
      const coach = await this.write("Coach", { ...previous, ...patch, updatedAt: now }, true, session);
      if (PRIVATE_FIELDS.some(key => body[key] !== undefined)) {
        const previousPrivate = await this.store.one("CoachPrivateProfile", { _id: coachId }, session);
        const privatePatch = Object.fromEntries(PRIVATE_FIELDS.filter(key => body[key] !== undefined).map(key => [key, key === "birthDate" ? date(body[key]) : text(body[key])]));
        await this.write("CoachPrivateProfile", { coachId, createdAt: now, ...previousPrivate, ...privatePatch, updatedAt: now }, !!previousPrivate, session);
      }
      for (const type of ["fields", "curriculums"] as const) if (body[type] !== undefined) await this.tags(coachId, type, list(body[type]), session);
      const changed = PROFILE_FIELDS.filter(key => body[key] !== undefined);
      // Same content as logProfileEdit, but atomic with the profile change.
      if (changed.length) await this.write("CoachContentEntry", { id: randomUUID(), coachId, kind: "EDIT_HISTORY", content: `프로필 수정: ${changed.join(", ")}`, authorEmail: author.email, authorName: author.name, sourceField: `coaches.${changed.join(",")}`, createdAt: now, updatedAt: now }, false, session);
      return dto(coach);
    });
  }
  async updateCoachStatus(coachId: string, value: unknown): Promise<{ id: string; status: string; isActive: boolean }> {
    const next = status(value, false); assertMongo(next, "INVALID_COACH_STATUS");
    return this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      const previous = await this.existing(coachId, session);
      const coach = await this.write("Coach", { ...previous, status: next, updatedAt: new Date() }, true, session);
      return { id: coachId, status: (coach.status as string).toLowerCase(), isActive: coach.isActive as boolean };
    });
  }
  async deleteCoach(coachId: string, deletedBy: string | null): Promise<void> {
    await this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      const previous = await this.existing(coachId, session), now = new Date();
      await this.write("Coach", { ...previous, deletedAt: now, deletedBy, updatedAt: now }, true, session);
    });
  }
}
