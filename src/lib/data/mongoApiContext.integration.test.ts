import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoCoachManagementRepository, prepareMongoCoachManagementStore } from "./mongoCoachManagementRepository";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoCoachPrivateRepository } from "./mongoCoachPrivateRepository";
import { prepareMongoReadStore, COACH_READ_MODELS } from "./mongoReadStore";
import { MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

// Synthetic identities only; actual application permission guards use the configured workspace domain.
const actorEmail = "mongo-synthetic-test@day1company.co.kr";
let session: { user: { email: string; name: string }; expires: string } | null = null;
mock.module("../../auth", { namedExports: { auth: async () => session } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const coachRoute = await import("../../app/api/coaches/route");
const coachDetailRoute = await import("../../app/api/coaches/[id]/route");
const instructorRoute = await import("../../app/api/instructor-wiki/save/route");
const privateService = await import("./coachPrivateAccess");
const { withActivity } = await import("../activity/request");
const { withCalendarOperationLock } = await import("../googleCalendar/calendarOperationLock");
const { getPrismaClient } = await import("./prisma");
const teamFacade = await import("./teamUsers/teamUserRepository");
hook.deregister();

const uri = process.env.MONGODB_API_CONTEXT_TEST_URI;
test("actual API/auth/activity and private access use one Mongo scope with no PostgreSQL fallback", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_api_${randomBytes(8).toString("hex")}`, namespace: "shadow_api", allowShadowWrites: true as const };
  const keys = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  process.env.ADMIN_EMAILS = actorEmail; delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  let connected = false;
  try {
    await client.connect(); connected = true;
    await prepareMongoCoachManagementStore(options); await prepareMongoReadStore(options, COACH_READ_MODELS);
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS); await prepareMongoTeamUserStore(options); await prepareMongoRequestAuditStore(options);
    const coachManagement = await MongoCoachManagementRepository.open(options);
    const instructorNote = await MongoInstructorNoteRepository.open(options);
    const teamUsers = await MongoTeamUserRepository.open(options);
    const coachPrivate = await MongoCoachPrivateRepository.open(options);
    const audit = await MongoRequestAuditRepository.open(options);
    const scope = { coachManagement, instructorNote, teamUsers, coachPrivate, coachPrivateAccessLog: audit, requestActivity: audit };
    const store = new MongoOperationStore(options, REQUEST_AUDIT_MODELS);
    const body = (path: string, value: unknown) => new Request(`https://example.invalid${path}`, { method: "POST", body: JSON.stringify(value) });
    await runWithDataRepositories(scope, async () => {
      session = null;
      await assert.rejects(coachRoute.POST(body("/api/coaches", { name: "Denied synthetic" })), /NEXT_REDIRECT/);
      await assert.rejects(instructorRoute.POST(body("/api/instructor-wiki/save", { name: "Denied synthetic", notes: "Must not save" })), /NEXT_REDIRECT/);
      assert.equal(await store.collection("Coach").countDocuments(), 0);
      assert.deepEqual(await instructorNote.listNotes(), []);
      session = { user: { email: actorEmail, name: "Synthetic manager" }, expires: "" };
      const response = await coachRoute.POST(body("/api/coaches", { name: "Synthetic route coach", email: "private@example.invalid", fields: ["Synthetic field"] }));
      assert.equal(response.status, 201);
      const id = (await response.json()).coach.id as string;
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const requestRow = (await store.collection("ActivityRequest").findOne({ _id: requestId }))!;
      assert.ok(requestRow); assert.ok(!JSON.stringify(requestRow).includes(actorEmail));
      const decoded = decodeMongoRuntimeDocument("ActivityRequest", requestRow);
      assert.equal(decoded.actorEmail, actorEmail); assert.equal(decoded.status, 201);
      const changes = await store.scan("ActivityChange", { requestId });
      assert.ok(changes.some(row => row.targetType === "coaches")); assert.ok(changes.some(row => row.targetType === "coach_private_profiles"));
      assert.ok(changes.some(row => row.targetType === "coach_fields"));
      const serialized = JSON.stringify(changes.map(row => row.changes));
      assert.ok(!serialized.includes("private@example.invalid")); assert.ok(!serialized.includes("Synthetic route coach"));
      // The new global mutation audit (not just profile content history) must roll back
      // an earlier coach update when the later private-profile audit is rejected by Mongo.
      const profileCollection = store.db.collection<MongoRuntimeDocument>(`${options.namespace}_CoachPrivateProfile`);
      const coachBefore = await store.collection("Coach").findOne({ _id: id });
      const profileBefore = await profileCollection.findOne({ _id: id });
      const auditCount = await store.collection("ActivityChange").countDocuments();
      const changeCollection = store.collection("ActivityChange");
      await store.db.command({ collMod: changeCollection.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetType: { $ne: "coach_private_profiles" } }] } });
      await assert.rejects(coachDetailRoute.PUT(body("/api/coaches/detail", { name: "Synthetic rolled back", email: "rolled-back@example.invalid" }), { params: Promise.resolve({ id }) }), /COACH_WRITE_FAILED/);
      assert.deepEqual(await store.collection("Coach").findOne({ _id: id }), coachBefore);
      assert.deepEqual(await profileCollection.findOne({ _id: id }), profileBefore);
      assert.equal(await changeCollection.countDocuments(), auditCount);
      await store.db.command({ collMod: changeCollection.collectionName, validator: operationMongoValidator("ActivityChange") });
      assert.equal((await instructorRoute.POST(body("/api/instructor-wiki/save", { name: "Synthetic instructor", notes: "Private note", recruitAvoid: true }))).status, 200);
      await instructorRoute.POST(body("/api/instructor-wiki/save", { name: "Synthetic instructor", recruitAvoid: false }));
      assert.equal((await instructorNote.getNote("Synthetic instructor")).notes, "Private note");
      assert.ok((await store.scan("ActivityChange", { targetType: "instructor_notes" })).length >= 2);
      const noteCollection = store.db.collection(`${options.namespace}_InstructorNote`);
      const noteBefore = await noteCollection.find({}).toArray();
      const noteAuditCount = await changeCollection.countDocuments();
      await store.db.command({ collMod: changeCollection.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetType: { $ne: "instructor_notes" } }] } });
      assert.equal((await instructorRoute.POST(body("/api/instructor-wiki/save", { name: "Synthetic instructor", notes: "Rejected note" }))).status, 500);
      assert.deepEqual(await noteCollection.find({}).toArray(), noteBefore);
      assert.equal(await changeCollection.countDocuments(), noteAuditCount);
      await store.db.command({ collMod: changeCollection.collectionName, validator: operationMongoValidator("ActivityChange") });
      await withActivity("/api/synthetic-team", "POST", async () => {
        const created = await teamFacade.createTeamUser({ name: "Synthetic staff", email: "staff@example.invalid", slackId: "synthetic" });
        await teamFacade.updateTeamUserTeam(created.id, "Synthetic team");
        return new Response("ok");
      })();
      assert.equal((await teamFacade.listTeamUsers()).length, 1);
      assert.ok((await store.scan("ActivityChange", { targetType: "team_users" })).length >= 2);
      session = { user: { email: "synthetic-nonadmin@day1company.co.kr", name: "Synthetic nonadmin" }, expires: "" };
      await assert.rejects(privateService.readCoachPrivateProfile(id, "synthetic-test"), /권한/);
      assert.equal(await store.collection("CoachPrivateAccessLog").countDocuments(), 0);
      session = { user: { email: actorEmail, name: "Synthetic manager" }, expires: "" };
      assert.equal((await privateService.readCoachPrivateProfile(id, "synthetic-test"))?.email, "private@example.invalid");
      const access = (await store.collection("CoachPrivateAccessLog").findOne({ coachId: id }))!;
      assert.ok(!JSON.stringify(access).includes(actorEmail));
      assert.equal(decodeMongoRuntimeDocument("CoachPrivateAccessLog", access).accessedByEmail, actorEmail);
      const accessCollection = store.collection("CoachPrivateAccessLog");
      await store.db.command({ collMod: accessCollection.collectionName, validator: { $and: [operationMongoValidator("CoachPrivateAccessLog"), { coachId: { $ne: id } }] } });
      let privateReads = 0;
      await runWithDataRepositories({ ...scope, coachPrivate: {
        getPrivateProfile: async coachId => { privateReads++; return coachPrivate.getPrivateProfile(coachId); },
        getEngagementFeedback: coachId => coachPrivate.getEngagementFeedback(coachId)
      } }, async () => {
        await assert.rejects(privateService.readCoachPrivateProfile(id, "synthetic-failing-audit"), /PRIVATE_ACCESS_AUDIT_FAILED/);
      });
      assert.equal(privateReads, 0);
      await store.db.command({ collMod: accessCollection.collectionName, validator: operationMongoValidator("CoachPrivateAccessLog") });
      const count = await store.collection("Coach").countDocuments();
      await assert.rejects(runWithDataRepositories({ coachManagement }, () => coachRoute.POST(body("/api/coaches", { name: "Missing recorder" }))), /DATA_REPOSITORY_NOT_CONFIGURED/);
      assert.equal(await store.collection("Coach").countDocuments(), count);
      const logs: unknown[][] = []; const consoleMock = mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
      try {
        const committed = await runWithDataRepositories({ ...scope, requestActivity: { recordRequest: async () => { throw new Error("synthetic-secret-do-not-log"); } } }, () => coachRoute.POST(body("/api/coaches", { name: "Synthetic committed despite request-log failure" })));
        assert.equal(committed.status, 201); assert.equal(await store.collection("Coach").countDocuments(), count + 1);
        assert.ok(logs.length > 0); assert.ok(!JSON.stringify(logs).includes("synthetic-secret-do-not-log"));
      } finally { consoleMock.mock.restore(); }
      assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      let externalWork = false;
      await assert.rejects(withCalendarOperationLock("synthetic", async () => { externalWork = true; }), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      assert.equal(externalWork, false);
      // Same retention bounds as PG, using synthetic records only.
      const old = { ...decoded, id: randomUUID(), occurredAt: new Date(Date.now() - 31 * 86_400_000) };
      await store.collection("ActivityRequest").insertOne(encodeMongoRuntimeDocument("ActivityRequest", old));
      assert.equal((await audit.pruneActivityBatch()).requests, 1);
      assert.ok(await store.collection("ActivityRequest").findOne({ _id: requestId }));
    });
  } finally {
    session = null;
    try { if (connected) await client.db(options.databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } }
  }
});
