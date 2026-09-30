import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { MongoClient } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore } from "./mongoOperationStore";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import type { CreateOperationInput } from "./operationTypes";

const uri = process.env.MONGODB_RUNTIME_TEST_URI;
const routePath = "/api/satisfaction/round-apply";
const date = "2099-09-21";

function input(suffix: string, day = date): CreateOperationInput {
  return {
    companyName: `Synthetic company ${suffix}`, courseName: `Synthetic course ${suffix}`,
    courseId: `SYNTHETIC-ROUND-${suffix}`, startDate: day, endDate: day, educationDates: [day],
    archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "단기",
    educationFormat: "오프라인", onsiteRequired: "N", revenue: null, totalCost: null,
    instructorCost: null, operationCost: null, coach: "", companyWikiLink: "", costRaw: "",
    driveLink: "", educationDays: "1", instructorWikiLink: "", instructors: "Synthetic instructor",
    ld: "", lectureManagementLink: "", om: "Synthetic owner", operationDetail: "Synthetic round",
    operationIssue: "", padletLink: "", region: "", resultReportLink: "", roundNo: "1",
    specialNotes: "", timeText: "09:00-10:00", createdBy: "synthetic@example.invalid"
  };
}

/** Opt in only to a disposable loopback replica set. Never load .env or infer a URI.
 * Real POST, withActivity, factory/context and Mongo repositories are exercised.
 * Auth is a supplier mock; PostgreSQL/fetch mocks only detect forbidden fallback.
 */
test("satisfaction round-apply actual POST and activity use native Mongo storage", {
  skip: !uri, timeout: 180_000
}, async suite => {
  const target = new URL(uri!);
  assert.equal(target.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Only a single loopback server is allowed");
  assert.ok(target.port, "An explicit disposable replica-set port is required");
  assert.equal(target.username, "");
  assert.equal(target.password, "");
  assert.ok(target.pathname === "" || target.pathname === "/", "Do not supply an existing database");
  assert.equal(target.hash, "");

  let pgCalls = 0;
  let authCalls = 0;
  suite.mock.module("@/auth", { namedExports: { auth: async () => { authCalls++; return null; } } });
  suite.mock.module("./prisma", { namedExports: {
    getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL fallback"); }
  } });
  const external = suite.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected external fetch");
  });
  const hook = registerHooks({ resolve(specifier, context, next) {
    return next(specifier === "next/server" ? "next/server.js" : specifier, context);
  } });
  const route = await (async () => {
    try { return await import("../../app/api/satisfaction/round-apply/route"); }
    finally { hook.deregister(); }
  })();

  const databaseName = `hub_om_shadow_round_apply_${randomBytes(12).toString("hex")}`;
  // directConnection prevents discovery of non-loopback replica-set members.
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const options = {
    client, databaseName, namespace: `shadow_round_${randomBytes(8).toString("hex")}`,
    allowShadowWrites: true as const
  };
  const token = randomBytes(32).toString("hex");
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "COURSE_LOOKUP_TOKEN", "DATABASE_URL", "OPERATION_DATA_SOURCE"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ round_fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "round_fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false", COURSE_LOOKUP_TOKEN: token,
    // If the scope regresses, choose PG and hit the sentinel rather than local JSON.
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    OPERATION_DATA_SOURCE: "postgres"
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await prepareMongoOperationStore({ ...options, processSequenceHighWater: 0 });
    await prepareMongoRequestAuditStore(options);
    const operations = await MongoOperationRepository.open(options);
    const requestActivity = await MongoRequestAuditRepository.open(options);
    const store = new MongoOperationStore(options, [...new Set([...OPERATION_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const scope = { operations, requestActivity };

    // Includes all business records, mutation audits, counters and guards. Request
    // logs are intentionally separate: even a 401/skip is logged by withActivity.
    async function snapshot() {
      const collections = await store.db.listCollections({}, { nameOnly: true }).toArray();
      const result: Record<string, unknown> = {};
      for (const entry of collections.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === store.collection("ActivityRequest").collectionName) continue;
        result[entry.name] = await store.db.collection(entry.name).find({}).sort({ _id: 1 }).toArray();
      }
      return result;
    }
    async function seed(suffix: string, overall = "3.00", instructor = "3.25") {
      const fields = input(suffix);
      const created = await operations.createOperation(fields);
      await operations.updateOperation(created.operationId, { avgSatisfaction: overall, instructorSatisfaction: instructor });
      assert.notEqual(created.id, created.operationId, "The route must write using the business key, not the row id");
      return { created, body: { courseId: fields.courseId, date, overall: "4.5", record_id: `synthetic-${suffix}` } };
    }
    async function post(body: Record<string, string>, suppliedToken = token, expectedStatus = 200) {
      const requestCount = await store.collection("ActivityRequest").countDocuments();
      const response = await runWithDataRepositories(scope, () => route.POST(new Request(`https://example.invalid${routePath}`, {
        method: "POST", headers: { authorization: `Bearer ${suppliedToken}`, "content-type": "application/json" },
        body: JSON.stringify(body)
      })));
      assert.equal(response.status, expectedStatus);
      const requestId = response.headers.get("X-Request-Id");
      assert.ok(requestId);
      const request = await store.one("ActivityRequest", { _id: requestId });
      assert.ok(request, "The real withActivity must persist a Mongo request audit");
      assert.equal(request.route, routePath);
      assert.equal(request.method, "POST");
      assert.equal(request.status, expectedStatus);
      assert.equal(request.actorType, "token_request");
      assert.equal(request.actorEmail, null);
      assert.equal(request.actorName, null);
      assert.equal(await store.collection("ActivityRequest").countDocuments(), requestCount + 1);
      assert.equal(pgCalls, 0);
      assert.equal(external.mock.callCount(), 0);
      assert.equal(authCalls, 0, "Token requests must not resolve a browser session");
      return { body: await response.json(), requestId };
    }
    async function assertSaved(id: string, operationId: string, overall: string, instructor: string) {
      const row = await store.one("OperationSession", { _id: id });
      assert.ok(row);
      assert.equal(row.avgSatisfaction, overall);
      assert.equal(row.instructorSatisfaction, instructor);
      const visible = await operations.getOperationById(operationId);
      assert.equal(visible?.avgSatisfaction, overall);
      assert.equal(visible?.instructorSatisfaction, instructor);
    }
    async function assertChange(requestId: string, id: string, fields: string[]) {
      const changes = await store.scan("ActivityChange", { requestId });
      assert.equal(changes.length, 1);
      const change = changes[0];
      assert.equal(change.targetType, "operation_sessions");
      assert.equal(change.targetId, id);
      assert.equal(change.action, "update");
      assert.equal(change.route, routePath);
      assert.equal(change.method, "POST");
      assert.equal(change.actorType, "token_request");
      assert.equal(change.actorEmail, null);
      assert.equal(change.actorName, null);
      // Satisfaction values follow the existing redacted mutation-audit policy.
      assert.deepEqual(change.changes, Object.fromEntries(fields.map(field => [field, { redacted: true }])));
    }
    async function assertSkipped(body: Record<string, string>, status: string) {
      const before = await snapshot();
      const result = await post(body);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.applied, false);
      assert.equal(result.body.status, status);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await store.scan("ActivityChange", { requestId: result.requestId }), []);
    }

    await suite.test("invalid token returns 401 without business writes or mutation audits", async () => {
      const fixture = await seed("denied");
      const before = await snapshot();
      const result = await post({ ...fixture.body, instructorSatisfaction: "4.75" }, `${token}-invalid`, 401);
      assert.equal(result.body.ok, false);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await store.scan("ActivityChange", { requestId: result.requestId }), []);
    });

    await suite.test("exact course/date stores both satisfaction fields and correlates mutation/request audits", async () => {
      const { created, body } = await seed("both", "");
      const otherDate = await operations.createOperation(input("both", "2099-10-22"));
      const otherCourse = await operations.createOperation(input("other-course"));
      const untouched = await Promise.all([otherDate, otherCourse].map(row => store.collection("OperationSession").findOne({ _id: row.id })));
      const result = await post({ ...body, instructorSatisfaction: " 4.75 " });
      assert.equal(result.body.ok, true);
      assert.equal(result.body.applied, true);
      assert.equal(result.body.status, "filled");
      assert.equal(result.body.value, "4.50");
      assert.equal(result.body.previous, null);
      await assertSaved(created.id, created.operationId, "4.50", "4.75");
      await assertChange(result.requestId, created.id, ["avg_satisfaction", "instructor_satisfaction"]);
      assert.deepEqual(await Promise.all([otherDate, otherCourse].map(row => store.collection("OperationSession").findOne({ _id: row.id }))), untouched);
    });

    for (const variant of ["omitted", "blank"] as const) {
      await suite.test(`${variant} instructor preserves existing average while overall changes`, async () => {
        const { created, body } = await seed(variant);
        const result = await post(variant === "blank" ? { ...body, instructorSatisfaction: "   " } : body);
        assert.equal(result.body.ok, true);
        assert.equal(result.body.applied, true);
        assert.equal(result.body.status, "overwritten");
        assert.equal(result.body.previous, "3.00");
        assert.equal(result.body.value, "4.50");
        await assertSaved(created.id, created.operationId, "4.50", "3.25");
        await assertChange(result.requestId, created.id, ["avg_satisfaction"]);
      });
    }

    await suite.test("same normalized overall skips even when instructor average differs (current dev behavior)", async () => {
      const { created, body } = await seed("same", "4.50");
      await assertSkipped({ ...body, instructorSatisfaction: "4.99" }, "same");
      await assertSaved(created.id, created.operationId, "4.50", "3.25");
    });

    await suite.test("unmatched course or date does not write", async () => {
      const { body } = await seed("unmatched");
      await assertSkipped({ ...body, courseId: "SYNTHETIC-NO-SUCH-COURSE", instructorSatisfaction: "4.99" }, "unmatched");
      await assertSkipped({ ...body, date: "2098-01-01", instructorSatisfaction: "4.99" }, "unmatched");
    });

    await suite.test("two exact course/date candidates are ambiguous and neither changes", async () => {
      const { body } = await seed("ambiguous");
      await operations.createOperation(input("ambiguous"));
      await assertSkipped({ ...body, instructorSatisfaction: "4.99" }, "ambiguous");
    });

    await suite.test("empty overall does not write even with a supplied instructor average", async () => {
      const { body } = await seed("empty");
      for (const overall of ["", "   "]) {
        await assertSkipped({ ...body, overall, instructorSatisfaction: "4.99" }, "empty");
      }
    });
    assert.equal(pgCalls, 0);
    assert.equal(external.mock.callCount(), 0);
  } finally {
    try {
      assert.match(databaseName, /^hub_om_shadow_round_apply_[a-f0-9]{24}$/);
      if (connected) await client.db(databaseName).dropDatabase();
    } finally {
      try { await client.close(); }
      finally {
        for (const [name, value] of saved) {
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
      }
    }
  }
});
