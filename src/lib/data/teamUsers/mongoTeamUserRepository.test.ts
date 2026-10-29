import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Long } from "mongodb";
import { activityContext } from "../../activity/context";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument } from "../mongoRuntimeCodec";
import { MongoOperationError, type MongoOperationStore, type MongoRow } from "../mongoOperationStore";
import { DuplicateTeamUserEmailError } from "./teamUserErrors";
import { MongoTeamUserRepository, prepareMongoTeamUserStore } from "./mongoTeamUserRepository";

function keys() {
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ synthetic: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "synthetic"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  return () => { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
}
function fixture(patch: MongoRow = {}) { return { id: randomUUID(), name: "Synthetic user", email: " SYNTHETIC@example.invalid ", slackId: "Synthetic slack", team: null, role: null, createdAt: new Date("2026-01-01"), ...patch }; }
function departureFixture(teamUserId: string, patch: MongoRow = {}) { return { id: randomUUID(), teamUserId, departedAt: new Date("2026-01-02"), ...patch }; }

function mock(initial: MongoRow[] = [], allowWrites = true, initialDepartures: MongoRow[] = []) {
  const documents = new Map(initial.map(row => [row.id as string, encodeMongoRuntimeDocument("TeamUser", row)]));
  const departures = new Map(initialDepartures.map(row => [row.id as string, encodeMongoRuntimeDocument("TeamUserDeparture", row)]));
  const calls: string[] = [];
  const audits: ReturnType<typeof encodeMongoRuntimeDocument>[] = [];
  let auditFailure = false;
  let guardMatches = 1, failReplaceAt = 0, replaceCount = 0, version = 0;
  const session = {
    async withTransaction(work: () => Promise<unknown>, options: unknown) {
      assert.deepEqual(options, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
      const previous = new Map(documents), previousDepartures = new Map(departures), previousVersion = version, previousAudits = [...audits];
      try { return await work(); } catch (error) {
        documents.clear(); for (const [id, doc] of previous) documents.set(id, doc);
        departures.clear(); for (const [id, doc] of previousDepartures) departures.set(id, doc);
        version = previousVersion; audits.splice(0, audits.length, ...previousAudits); throw error;
      }
    },
    async endSession() { calls.push("endSession"); }
  };
  const guard = { async updateOne(filter: unknown, update: unknown, options: { session: unknown }) {
    assert.equal(options.session, session); assert.deepEqual(filter, { _id: "TeamUser", version: { $lt: Long.MAX_VALUE } }); assert.deepEqual(update, { $inc: { version: Long.ONE } });
    calls.push("guard"); version++; return { matchedCount: guardMatches };
  } };
  const store = {
    namespace: "shadow_test",
    db: { collection(name: string) { assert.equal(name, "shadow_test___teamUserWriteGuard"); return guard; } },
    client: { startSession() { calls.push("startSession"); return session; } },
    async one(model: string, filter: { _id?: string; teamUserId?: string }, options?: unknown) {
      assert.ok(model === "TeamUser" || model === "TeamUserDeparture"); if (options) assert.equal(options, session); calls.push("one");
      if (model === "TeamUser") {
        const row = documents.get(filter._id as string); return row ? decodeMongoRuntimeDocument(model, row) : null;
      }
      const match = [...departures.values()].map(doc => decodeMongoRuntimeDocument(model, doc)).find(row => row.teamUserId === filter.teamUserId);
      return match ?? null;
    },
    async scan(model: string, filter?: { _id?: { $in: string[] }; teamUserId?: { $in: string[] } }, options?: unknown) {
      assert.ok(model === "TeamUser" || model === "TeamUserDeparture"); if (options) assert.equal(options, session); calls.push("scan");
      if (model === "TeamUser") {
        return [...documents.entries()].filter(([id]) => !filter?._id || filter._id.$in.includes(id)).map(([, doc]) => decodeMongoRuntimeDocument(model, doc));
      }
      const rows = [...departures.values()].map(doc => decodeMongoRuntimeDocument(model, doc));
      return filter?.teamUserId ? rows.filter(row => filter.teamUserId!.$in.includes(row.teamUserId as string)) : rows;
    },
    collection(model: string) {
      if (model === "ActivityChange") return { async insertOne(doc: ReturnType<typeof encodeMongoRuntimeDocument>, options: { session: unknown }) {
        assert.equal(options.session, session); calls.push("audit"); if (auditFailure) throw new Error("Synthetic audit failure"); audits.push(doc);
      } };
      if (model === "TeamUserDeparture") return {
        async insertOne(doc: ReturnType<typeof encodeMongoRuntimeDocument>, options: { session: unknown }) { assert.equal(options.session, session); calls.push("departure.insert"); departures.set(String(doc._id), doc); },
        async deleteOne(filter: { _id: string }, options: { session: unknown }) {
          assert.equal(options.session, session); calls.push("departure.delete");
          const existed = departures.delete(filter._id); return { deletedCount: existed ? 1 : 0 };
        }
      };
      assert.equal(model, "TeamUser"); return {
      async insertOne(doc: ReturnType<typeof encodeMongoRuntimeDocument>, options: { session: unknown }) { assert.equal(options.session, session); calls.push("insert"); documents.set(String(doc._id), doc); },
      async replaceOne(filter: { _id: string }, doc: ReturnType<typeof encodeMongoRuntimeDocument>, options: { session: unknown }) {
        assert.equal(options.session, session); calls.push("replace"); replaceCount++;
        if (replaceCount === failReplaceAt) throw new Error("synthetic-secret@example.invalid");
        if (!documents.has(filter._id)) return { matchedCount: 0 };
        documents.set(filter._id, doc); return { matchedCount: 1 };
      }
    }; }
  };
  const Constructor = MongoTeamUserRepository as unknown as new (store: MongoOperationStore, allow: boolean) => MongoTeamUserRepository;
  return { repository: new Constructor(store as unknown as MongoOperationStore, allowWrites), calls, documents, departures, audits, failAudit() { auditFailure = true; },
    guardMissing() { guardMatches = 0; }, failSecondReplace() { failReplaceAt = 2; }, get version() { return version; } };
}

test("TeamUser lists preserve descending dates, optional null DTOs and all normalized email matches", async () => {
  const restore = keys();
  try {
    const old = fixture(), recent = fixture({ name: "Second", role: "LD", team: "AX 1파트", createdAt: new Date("2026-02-01"), email: "synthetic@EXAMPLE.INVALID" });
    const { repository, calls } = mock([old, recent]);
    const users = await repository.listTeamUsers(); assert.deepEqual(users.map(row => row.id), [recent.id, old.id]);
    assert.equal(users[0].role, "ld"); assert.equal(users[1].role, undefined); assert.equal(users[1].team, undefined);
    assert.equal(users[0].status, "active"); assert.equal(users[1].status, "active");
    assert.equal((await repository.findTeamUsersByEmail(" Synthetic@example.invalid  ")).length, 2);
    const previousCalls = calls.length; assert.deepEqual(await repository.findTeamUsersByEmail("  "), []); assert.deepEqual(await repository.findTeamUsersByEmail(null), []); assert.equal(calls.length, previousCalls);
    assert.ok(!calls.includes("guard"));
  } finally { restore(); }
});
test("TeamUser lists compute status from TeamUserDeparture existence, not a TeamUser field", async () => {
  const restore = keys();
  try {
    const departed = fixture({ name: "Departed" }), active = fixture({ name: "Active" });
    const { repository } = mock([departed, active], true, [departureFixture(departed.id as string)]);
    const users = await repository.listTeamUsers();
    assert.equal(users.find(u => u.id === departed.id)?.status, "departed");
    assert.equal(users.find(u => u.id === active.id)?.status, "active");
  } finally { restore(); }
});
test("TeamUser create uses first-write guard, encrypted storage and safe compatible duplicate error", async () => {
  const restore = keys();
  try {
    const state = mock(); const input = { name: "Synthetic private name", email: "SYNTHETIC@example.invalid", slackId: "Synthetic private slack", role: "om" as const };
    const created = await state.repository.createTeamUser(input); assert.equal(created.role, "om"); assert.equal(created.status, "active"); assert.match(created.id, /^[a-f0-9-]{36}$/);
    assert.deepEqual(state.calls, ["startSession", "guard", "scan", "insert", "endSession"]);
    const stored = JSON.stringify([...state.documents.values()]); assert.ok(!stored.includes(input.email)); assert.ok(!stored.includes(input.name)); assert.ok(!stored.includes(input.slackId));
    await assert.rejects(state.repository.createTeamUser({ ...input, email: " synthetic@EXAMPLE.INVALID " }), error => {
      assert.ok(error instanceof DuplicateTeamUserEmailError); assert.equal(error.name, "DuplicateTeamUserEmailError"); assert.deepEqual(error.existingNames, []);
      assert.ok(!error.message.includes("@")); assert.ok(!JSON.stringify(error).includes(input.name)); return true;
    });
    assert.equal(state.documents.size, 1); assert.equal(state.version, 1, "failed transaction rolls back its guard update");
  } finally { restore(); }
});
test("TeamUser updates preserve other columns, count unique matched ids and return null only for absent rows", async () => {
  const restore = keys();
  try {
    const row = fixture(), state = mock([row]);
    const result = await state.repository.updateTeamUserTeam(row.id as string, "AX 2파트"); assert.equal(result?.email, row.email); assert.equal(result?.team, "AX 2파트"); assert.equal(result?.status, "active");
    assert.equal(await state.repository.updateTeamUsersRole([row.id as string, row.id as string, randomUUID()], "ld"), 1);
    assert.equal(await state.repository.updateTeamUsersStatus([row.id as string, row.id as string], "departed"), 1, "duplicate ids count once");
    assert.equal((await state.repository.listTeamUsers())[0].team, "AX 2파트"); assert.equal((await state.repository.listTeamUsers())[0].role, "ld");
    assert.equal((await state.repository.listTeamUsers())[0].status, "departed");
    assert.equal((await state.repository.updateTeamUserTeam(row.id as string, null))?.team, undefined);
    assert.equal((await state.repository.updateTeamUserTeam(row.id as string, null))?.status, "departed", "team edit never disturbs an existing departure record");
    assert.equal(await state.repository.updateTeamUserTeam(randomUUID(), "AX 1파트"), null);
    assert.equal(await state.repository.updateTeamUsersRole([], "om"), 0);
    assert.equal(await state.repository.updateTeamUsersStatus([], "active"), 0);
    assert.equal(await state.repository.updateTeamUsersStatus([row.id as string], "departed"), 0, "idempotent: already departed adds no new record");
    assert.equal(await state.repository.updateTeamUsersStatus([row.id as string], "active"), 1);
    assert.equal((await state.repository.listTeamUsers())[0].status, "active");
    assert.equal(await state.repository.updateTeamUsersStatus([row.id as string], "active"), 0, "idempotent: already active removes nothing");
  } finally { restore(); }
});
test("TeamUser failed batch rolls back all documents and strips underlying error payload", async () => {
  const restore = keys();
  try {
    const state = mock([fixture(), fixture()]); const original = [...state.documents.entries()]; state.failSecondReplace();
    await assert.rejects(state.repository.updateTeamUsersRole(original.map(([id]) => id), "ld"), error => { assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "TEAM_USER_ACCESS_FAILED"); assert.ok(!String(error).includes("@")); return true; });
    assert.deepEqual([...state.documents.entries()], original); assert.equal(state.version, 0); assert.equal(state.calls.at(-1), "endSession");
  } finally { restore(); }
});
test("TeamUser mutation gates and deletion policy fail closed before changing data", async () => {
  const restore = keys();
  try {
    const row = fixture(), disabled = mock([row], false), state = mock([row]);
    await assert.rejects(disabled.repository.updateTeamUserTeam(row.id as string, null), /SHADOW_WRITE_GATE/);
    await assert.rejects(disabled.repository.updateTeamUsersRole([], "om"), /SHADOW_WRITE_GATE/);
    await assert.rejects(disabled.repository.updateTeamUsersStatus([], "active"), /SHADOW_WRITE_GATE/);
    await assert.rejects(disabled.repository.createTeamUser({ name: "", email: "", slackId: "" }), /SHADOW_WRITE_GATE/);
    await assert.rejects(state.repository.deleteTeamUsers([row.id as string]), /TEAM_USER_DELETE_POLICY_REQUIRED/);
    assert.equal(disabled.calls.length, 0); assert.equal(state.calls.length, 0);
    state.guardMissing(); await assert.rejects(state.repository.updateTeamUserTeam(row.id as string, null), /TEAM_USER_GUARD_UNAVAILABLE/); assert.ok(!state.calls.includes("one"));
    await assert.rejects(prepareMongoTeamUserStore({ allowShadowWrites: false } as never), /SHADOW_WRITE_GATE/);
  } finally { restore(); }
});
test("TeamUser ciphertext tampering aborts before replacement and validates role/id inputs", async () => {
  const restore = keys();
  try {
    const row = fixture(), state = mock([row]); const doc = state.documents.get(row.id as string)!; doc.emailPiiIndex = "f".repeat(64);
    await assert.rejects(state.repository.updateTeamUserTeam(row.id as string, "AX 2파트"), /TEAM_USER_ACCESS_FAILED/); assert.ok(!state.calls.includes("replace"));
    await assert.rejects(state.repository.updateTeamUserTeam("wrong", "x"), /INVALID_TEAM_USER_INPUT/);
    await assert.rejects(state.repository.updateTeamUsersRole([row.id as string], "admin" as never), /INVALID_TEAM_USER_INPUT/);
    await assert.rejects(state.repository.updateTeamUsersStatus([row.id as string], "retired" as never), /INVALID_TEAM_USER_INPUT/);
  } finally { restore(); }
});

const auditContext = { requestId: "00000000-0000-4000-8000-000000000001", route: "/api/admin/users", method: "POST", actorEmail: "actor@example.invalid", actorName: "Synthetic actor", actorType: "user" as const };
test("TeamUser writes audit redacted values in the same transaction and roll back when audit fails", async () => {
  const restore = keys();
  try {
    const state = mock();
    const created = await activityContext.run(auditContext, () => state.repository.createTeamUser({ name: "Synthetic private", email: "private@example.invalid", slackId: "private-slack" }));
    assert.equal(state.audits.length, 1);
    const audit = decodeMongoRuntimeDocument("ActivityChange", state.audits[0]);
    assert.equal(audit.targetType, "team_users"); assert.equal(audit.targetId, created.id); assert.equal(audit.action, "create");
    assert.equal(audit.requestId, auditContext.requestId);
    assert.deepEqual((audit.changes as Record<string, unknown>).name, { redacted: true });
    assert.deepEqual((audit.changes as Record<string, unknown>).email, { redacted: true });
    assert.deepEqual((audit.changes as Record<string, unknown>).slack_id, { redacted: true });
    assert.ok(!JSON.stringify(state.audits).includes("private@example.invalid")); assert.ok(!JSON.stringify(state.audits).includes(auditContext.actorEmail));
    await activityContext.run(auditContext, () => state.repository.updateTeamUserTeam(created.id, "AX 2파트"));
    await activityContext.run(auditContext, () => state.repository.updateTeamUsersRole([created.id], "om"));
    await activityContext.run(auditContext, () => state.repository.updateTeamUsersStatus([created.id], "departed"));
    assert.equal(state.audits.length, 4);
    const teamAudit = decodeMongoRuntimeDocument("ActivityChange", state.audits[1]);
    const roleAudit = decodeMongoRuntimeDocument("ActivityChange", state.audits[2]);
    const departureAudit = decodeMongoRuntimeDocument("ActivityChange", state.audits[3]);
    assert.deepEqual((teamAudit.changes as Record<string, unknown>).team, { before: null, after: "AX 2파트" });
    assert.deepEqual((roleAudit.changes as Record<string, unknown>).role, { before: null, after: "om" });
    assert.equal(departureAudit.targetType, "team_user_departures"); assert.equal(departureAudit.action, "create");
    assert.deepEqual((departureAudit.changes as Record<string, unknown>).team_user_id, { before: null, after: created.id });
    const before = [...state.documents.entries()], beforeDepartures = [...state.departures.entries()], beforeAudits = [...state.audits], beforeVersion = state.version;
    state.failAudit();
    await assert.rejects(activityContext.run(auditContext, () => state.repository.updateTeamUserTeam(created.id, "AX 3파트")), /TEAM_USER_ACCESS_FAILED/);
    assert.deepEqual([...state.documents.entries()], before); assert.deepEqual([...state.departures.entries()], beforeDepartures); assert.deepEqual(state.audits, beforeAudits); assert.equal(state.version, beforeVersion);
  } finally { restore(); }
});
