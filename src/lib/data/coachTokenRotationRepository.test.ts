import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import ts from "typescript";
import { activityContext } from "../activity/context";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import type { MongoOperationStore } from "./mongoOperationStore";
import { MongoCoachTokenRotationRepository } from "./mongoCoachTokenRotationRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";

const context = { requestId: "00000000-0000-4000-8000-000000000001", route: "/api/coaches/synthetic/regenerate-token", method: "POST", actorEmail: "synthetic@example.invalid", actorName: "Synthetic actor", actorType: "user" as const };
const calls: unknown[] = [];
let pgFailure: unknown;
mock.module("./prisma", { namedExports: { getPrismaClient: () => ({ coach: { async update(args: { where: { id: string }; data: { accessToken: string } }) {
  calls.push(args); if (pgFailure) throw pgFailure; return { id: args.where.id, accessToken: args.data.accessToken };
} } }) } });
const { PrismaCoachTokenRotationRepository } = await import("./prismaCoachTokenRotationRepository");
const { getCoachTokenRotationRepository } = await import("./coachTokenRotationRepositoryFactory");
function keys() {
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  return () => { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
}
function mongo(deleted = false) {
  const row = coachFixtureRow("Coach", { name: "Synthetic coach", accessToken: "synthetic-old-token", deletedAt: deleted ? new Date() : null });
  let document = encodeMongoRuntimeDocument("Coach", row);
  const audit: ReturnType<typeof encodeMongoRuntimeDocument>[] = [], operations: string[] = [];
  let failAudit = false, collision = false;
  const session = {
    async withTransaction(work: () => Promise<unknown>, options: unknown) {
      assert.deepEqual(options, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
      const before = document, beforeAudit = [...audit];
      try { return await work(); } catch (error) { document = before; audit.splice(0, audit.length, ...beforeAudit); throw error; }
    }, async endSession() { operations.push("end"); }
  };
  const store = {
    client: { startSession() { return session; } },
    async one(model: string, filter: unknown, currentSession: unknown) { assert.equal(model, "Coach"); assert.equal(currentSession, session); assert.deepEqual(filter, { _id: row.id, deletedAt: null }); operations.push("read"); return deleted ? null : decodeMongoRuntimeDocument("Coach", document); },
    collection(model: string) { return {
      async replaceOne(filter: unknown, next: typeof document, options: { session: unknown }) { assert.equal(model, "Coach"); assert.deepEqual(filter, { _id: row.id, deletedAt: null }); assert.equal(options.session, session); operations.push("replace"); if (collision) throw Object.assign(new Error("synthetic-token-must-not-leak"), { code: 11000 }); document = next; return { matchedCount: 1 }; },
      async insertOne(next: typeof document, options: { session: unknown }) { assert.equal(model, "ActivityChange"); assert.equal(options.session, session); operations.push("audit"); if (failAudit) throw new Error("synthetic-private-payload"); audit.push(next); }
    }; }
  };
  const Constructor = MongoCoachTokenRotationRepository as unknown as new (store: MongoOperationStore) => MongoCoachTokenRotationRepository;
  return { repository: new Constructor(store as unknown as MongoOperationStore), row, audit, operations, get document() { return document; }, failAudit() { failAudit = true; }, collision() { collision = true; } };
}

test("Prisma token rotation atomically filters deleted rows and only maps missing rows to null", async () => {
  const repository = new PrismaCoachTokenRotationRepository(); pgFailure = undefined;
  const rotated = await repository.regenerateToken("synthetic-id"); assert.match(rotated!.accessToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls.at(-1), { where: { id: "synthetic-id", deletedAt: null }, data: { accessToken: rotated!.accessToken }, select: { id: true, accessToken: true } });
  pgFailure = { code: "P2025" }; assert.equal(await repository.regenerateToken("synthetic-id"), null);
  pgFailure = new Error("synthetic-private-payload"); await assert.rejects(repository.regenerateToken("synthetic-id"), /^Error: COACH_TOKEN_ROTATION_FAILED$/); pgFailure = undefined;
});
test("Token rotation factory keeps default Prisma and refuses missing-scoped or failed-repository fallback", async () => {
  assert.ok(getCoachTokenRotationRepository() instanceof PrismaCoachTokenRotationRepository);
  const expected = { regenerateToken: async () => { throw new Error("Synthetic scoped failure"); } }, before = calls.length;
  await runWithDataRepositories({ coachTokenRotation: expected }, async () => {
    assert.equal(getCoachTokenRotationRepository(), expected);
    await assert.rejects(getCoachTokenRotationRepository().regenerateToken("synthetic-id"), /Synthetic scoped failure/);
  });
  assert.throws(() => runWithDataRepositories({}, getCoachTokenRotationRepository), /DATA_REPOSITORY_NOT_CONFIGURED/); assert.equal(calls.length, before);
});
test("Mongo token rotation encrypts new value/index, preserves other fields and records redacted audit atomically", async () => {
  const restore = keys();
  try {
    const state = mongo(), result = await activityContext.run(context, () => state.repository.regenerateToken(state.row.id as string));
    assert.match(result!.accessToken, /^[a-f0-9]{64}$/); assert.notEqual(result!.accessToken, state.row.accessToken);
    const stored = decodeMongoRuntimeDocument("Coach", state.document); assert.equal(stored.name, state.row.name); assert.equal(stored.accessToken, result!.accessToken);
    assert.equal(state.document.accessTokenPiiIndex, mongoRuntimeBlindIndex("Coach", "accessToken", result!.accessToken));
    assert.notEqual(state.document.accessTokenPiiIndex, mongoRuntimeBlindIndex("Coach", "accessToken", state.row.accessToken as string));
    assert.ok(!JSON.stringify(state.document).includes(result!.accessToken));
    assert.equal(state.audit.length, 1); const audit = decodeMongoRuntimeDocument("ActivityChange", state.audit[0]);
    assert.deepEqual((audit.changes as Record<string, unknown>).access_token, { redacted: true }); assert.equal(audit.requestId, context.requestId);
    assert.deepEqual(state.operations, ["read", "replace", "audit", "end"]);
  } finally { restore(); }
});
test("Mongo token rotation missing/deleted row returns null and unique/audit failures roll back without secret errors", async () => {
  const restore = keys();
  try {
    const deleted = mongo(true); assert.equal(await deleted.repository.regenerateToken(deleted.row.id as string), null); assert.deepEqual(deleted.operations, ["read", "end"]);
    for (const failure of ["collision", "failAudit"] as const) {
      const state = mongo(), before = state.document; state[failure]();
      await assert.rejects(activityContext.run(context, () => state.repository.regenerateToken(state.row.id as string)), /COACH_TOKEN_ROTATION_FAILED/);
      assert.deepEqual(state.document, before); assert.deepEqual(state.audit, []);
    }
  } finally { restore(); }
});
test("Actual token rotation handler authenticates before repository use and returns existing response or deleted 404", async () => {
  const source = readFileSync(new URL("../../app/api/coaches/[id]/regenerate-token/route.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let authorized = false, rotations = 0, absent = false;
  const modules: Record<string, unknown> = {
    "@/lib/activity/request": { withActivity: (_route: string, _method: string, work: unknown) => work },
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/auth/requireWorkspaceSession": { async requireWorkspaceSession() { if (!authorized) throw new Error("SYNTHETIC_UNAUTHENTICATED"); return { user: { email: "synthetic@example.invalid" } }; } },
    "@/lib/data/coachTokenRotationRepositoryFactory": { getCoachTokenRotationRepository }
  };
  const exports: { POST?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  new Function("require", "exports", javascript)((name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; }, exports);
  const expectedId = "abcdefab-1234-4000-8000-123456abcdef";
  const override = { async regenerateToken(id: string) { rotations++; assert.equal(id, expectedId); return absent ? null : { id, accessToken: "Synthetic-MiXeD-New-Token" }; } };
  await runWithDataRepositories({ coachTokenRotation: override }, async () => {
    const call = (id = "AbCdEFaB-1234-4000-8000-123456ABCDef") => exports.POST!(new Request("https://synthetic.invalid", { method: "POST" }), { params: Promise.resolve({ id }) });
    await assert.rejects(call(), /SYNTHETIC_UNAUTHENTICATED/); assert.equal(rotations, 0);
    authorized = true;
    for (const invalid of ["", "synthetic-id", ` ${expectedId}`, `${expectedId}x`]) assert.equal((await call(invalid)).status, 400);
    assert.equal(rotations, 0, "Invalid UUID must fail before obtaining the repository");
    const response = await call(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { ok: true, accessToken: "Synthetic-MiXeD-New-Token" }, "Token case must be preserved exactly");
    assert.equal((await call(expectedId.toUpperCase())).status, 200);
    absent = true; assert.equal((await call()).status, 404);
  });
});
