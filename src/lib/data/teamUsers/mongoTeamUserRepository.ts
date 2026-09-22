import { randomUUID } from "node:crypto";
import { Long, MongoServerError, type ClientSession } from "mongodb";
import { encodeMongoRuntimeDocument } from "../mongoRuntimeCodec";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "../mongoReadStore";
import { assertMongo, MONGO_SCAN_ROWS, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow, stableMongoValue } from "../mongoOperationStore";
import { DuplicateTeamUserEmailError } from "./teamUserRepository";
import type { TeamUser, TeamUserInput, TeamUserRole } from "./teamUserTypes";

export const MONGO_TEAM_USER_MODELS = ["TeamUser"] as const;
export type MongoTeamUserOptions = MongoOperationOptions & { allowShadowWrites?: true };
const guardValidator = { $jsonSchema: { bsonType: "object", required: ["_id", "version"], additionalProperties: false, properties: { _id: { enum: ["TeamUser"] }, version: { bsonType: "long", minimum: 0 } } } };
function guardCollection(store: MongoOperationStore) { return store.db.collection<{ _id: string; version: Long }>(`${store.namespace}___teamUserWriteGuard`, { promoteLongs: false }); }
async function assertGuardReady(store: MongoOperationStore): Promise<void> {
  const collection = guardCollection(store);
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error" && stableMongoValue(info.options.validator) === stableMongoValue(guardValidator), "TEAM_USER_GUARD_NOT_READY");
  assertMongo(!info.options.collation || info.options.collation.locale === "simple", "COLLATION_NOT_SUPPORTED");
  const guard = await collection.findOne({ _id: "TeamUser" });
  assertMongo(guard && Long.isLong(guard.version) && !guard.version.isNegative(), "TEAM_USER_GUARD_NOT_READY");
}
/** Explicit setup for synthetic/shadow namespace only; ordinary open and reads never initialize it. */
export async function prepareMongoTeamUserStore(options: MongoOperationOptions & { allowShadowWrites: true }): Promise<void> {
  assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
  await prepareMongoReadStore(options, MONGO_TEAM_USER_MODELS);
  const store = new MongoOperationStore(options, MONGO_TEAM_USER_MODELS), collection = guardCollection(store);
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  if (!info) await store.db.createCollection(collection.collectionName, { validator: guardValidator, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
  else assertMongo(stableMongoValue(info.options?.validator) === stableMongoValue(guardValidator), "TEAM_USER_GUARD_NOT_READY");
  try { await collection.insertOne({ _id: "TeamUser", version: Long.ZERO }); }
  catch (error) { if (!(error instanceof MongoServerError && error.code === 11000)) throw new MongoOperationError("TEAM_USER_GUARD_PREPARATION_FAILED"); }
  await assertGuardReady(store);
}
const roleToDatabase = { ld: "LD", om: "OM" } as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function emailKey(value: string | null | undefined): string { return (value ?? "").trim().toLowerCase(); }
function toTeamUser(row: MongoRow): TeamUser {
  return { id: row.id as string, name: row.name as string, email: row.email as string, slackId: row.slackId as string,
    team: row.team === null ? undefined : row.team as string,
    role: row.role === null ? undefined : row.role === "LD" ? "ld" : "om",
    createdAt: (row.createdAt as Date).toISOString() };
}
/** Keeps the existing caller's instanceof contract without exposing names/email in errors. */
export class MongoDuplicateTeamUserEmailError extends DuplicateTeamUserEmailError {
  readonly code = "DUPLICATE_TEAM_USER_EMAIL";
  constructor() { super("", []); this.message = "이미 명단에 있는 이메일입니다."; }
}
async function safely<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof MongoOperationError || error instanceof MongoDuplicateTeamUserEmailError) throw error;
    throw new MongoOperationError("TEAM_USER_ACCESS_FAILED");
  }
}
/** Shadow adapter; callers retain existing authentication/authorization responsibilities.
 * Every writer must participate in the guard; direct imports/writes remain a cutover gate.
 * Physical deletion is deliberately blocked pending an approved deletion contract.
 */
export class MongoTeamUserRepository {
  private readonly store: MongoOperationStore;
  private readonly allowWrites: boolean;
  private constructor(store: MongoOperationStore, allowWrites: boolean) { this.store = store; this.allowWrites = allowWrites; }
  static async open(options: MongoTeamUserOptions): Promise<MongoTeamUserRepository> {
    return safely(async () => {
      const store = new MongoOperationStore(options, MONGO_TEAM_USER_MODELS);
      await assertMongoReadStoreReady(store);
      await assertGuardReady(store);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      return new MongoTeamUserRepository(store, options.allowShadowWrites === true);
    });
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    assertMongo(this.allowWrites, "SHADOW_WRITE_GATE");
    return safely(async () => {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          // First write forces concurrent creators/updaters onto one serial order, including an empty roster.
          const result = await guardCollection(this.store).updateOne({ _id: "TeamUser", version: { $lt: Long.MAX_VALUE } }, { $inc: { version: Long.ONE } }, { session });
          assertMongo(result.matchedCount === 1, "TEAM_USER_GUARD_UNAVAILABLE");
          return work(session);
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
      } finally { await session.endSession(); }
    });
  }
  async listTeamUsers(): Promise<TeamUser[]> {
    return safely(async () => {
      const rows = await this.store.scan("TeamUser");
      rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return rows.map(toTeamUser);
    });
  }
  async findTeamUsersByEmail(email: string | null | undefined): Promise<TeamUser[]> {
    const target = emailKey(email);
    if (!target) return [];
    // Existing values can differ in casing/whitespace. Exact HMAC lookup would miss them.
    return (await this.listTeamUsers()).filter(user => emailKey(user.email) === target);
  }
  async createTeamUser(input: TeamUserInput): Promise<TeamUser> {
    assertMongo(this.allowWrites, "SHADOW_WRITE_GATE");
    assertMongo(typeof input.email === "string", "INVALID_TEAM_USER_INPUT");
    assertMongo(typeof input.name === "string" && typeof input.slackId === "string" && (input.team === undefined || typeof input.team === "string") && (input.role === undefined || input.role === "ld" || input.role === "om"), "INVALID_TEAM_USER_INPUT");
    return this.transaction(async session => {
      const target = emailKey(input.email);
      // Preserve existing empty-email semantics, but examine all legacy casing/space variants.
      const existing = target ? (await this.store.scan("TeamUser", {}, session)).filter(row => emailKey(row.email as string) === target) : [];
      if (existing.length) throw new MongoDuplicateTeamUserEmailError();
      const row = { id: randomUUID(), name: input.name, email: input.email, slackId: input.slackId, team: input.team ?? null, role: input.role ? roleToDatabase[input.role] : null, createdAt: new Date() };
      await this.store.collection("TeamUser").insertOne(encodeMongoRuntimeDocument("TeamUser", row), { session });
      return toTeamUser(row);
    });
  }

  async updateTeamUserTeam(id: string, team: string | null): Promise<TeamUser | null> {
    assertMongo(uuid.test(id) && (team === null || typeof team === "string"), "INVALID_TEAM_USER_INPUT");
    return this.transaction(async session => {
      const previous = await this.store.one("TeamUser", { _id: id }, session);
      if (!previous) return null;
      const next = { ...previous, team };
      const result = await this.store.collection("TeamUser").replaceOne({ _id: id }, encodeMongoRuntimeDocument("TeamUser", next), { session });
      assertMongo(result.matchedCount === 1, "TEAM_USER_ROW_DISAPPEARED");
      return toTeamUser(next);
    });
  }
  async updateTeamUsersRole(ids: string[], role: TeamUserRole): Promise<number> {
    assertMongo(Array.isArray(ids) && ids.length <= MONGO_SCAN_ROWS && ids.every(id => typeof id === "string" && uuid.test(id)) && (role === "ld" || role === "om"), "INVALID_TEAM_USER_INPUT");
    return this.transaction(async session => {
      if (ids.length === 0) return 0;
      const rows = await this.store.scan("TeamUser", { _id: { $in: [...new Set(ids)] } }, session);
      for (const previous of rows) {
        const result = await this.store.collection("TeamUser").replaceOne({ _id: previous.id as string }, encodeMongoRuntimeDocument("TeamUser", { ...previous, role: roleToDatabase[role] }), { session });
        assertMongo(result.matchedCount === 1, "TEAM_USER_ROW_DISAPPEARED");
      }
      return rows.length;
    });
  }
  async deleteTeamUsers(ids: string[]): Promise<number> {
    void ids;
    assertMongo(this.allowWrites, "SHADOW_WRITE_GATE");
    throw new MongoOperationError("TEAM_USER_DELETE_POLICY_REQUIRED");
  }
}
