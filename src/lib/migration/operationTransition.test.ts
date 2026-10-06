import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createDecipheriv, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import sourceFixture from "./fixtures/operation-source.json" with { type: "json" };
import targetFixture from "./fixtures/operation-target.json" with { type: "json" };
import { assertTransitionBaseline, decimal14_2, mapOperationSlice, transitionManifest, TransitionError, verifyOperationSlice, type TransitionSource, type TransitionTarget } from "./operationTransition";

const source = () => structuredClone(sourceFixture) as TransitionSource;
const target = () => structuredClone(targetFixture) as TransitionTarget;
const fails = (fn: () => unknown, code: string) => assert.throws(fn, (error: unknown) => error instanceof TransitionError && error.code === code);

test("independent four-model golden fixture preserves precision, leap dates, PII bytes and original IDs", () => {
  const result = verifyOperationSlice(source(), target(), 25);
  assert.equal(result.equivalent, true);
  assert.equal(result.readyForCutover, false);
  assert.equal(result.unverified.includes("authenticated-ciphertext-and-hmac"), true);
  assert.deepEqual(result.counts, { companies: 1, courses: 1, operation_sessions: 1, calendar_event_links: 1 });
  const proposal = mapOperationSlice(source(), 25);
  assert.equal(proposal.sequenceHighWater, 25); // Not reset to the largest row value (17).
  assert.deepEqual(proposal.collections.operation_sessions[0].startDate, { $date: { $numberLong: "1709164800000" } });
  assert.deepEqual(proposal.collections.courses[0].revenue, { $numberDecimal: "999999999999.99" });
  assert.deepEqual(source(), sourceFixture); // Mapping must not mutate inputs.
});

test("archived four-model manifest covers its golden fixtures and rejects the newer encrypted schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  // This proposal predates the encrypted schema. Keep its guard closed; the
  // current 35-model codec has separate schema, encryption and BSON tests.
  assert.notEqual(createHash("sha256").update(schema).digest("hex"), transitionManifest.sourceSchemaSha256);
  const allModels = [...schema.matchAll(/^model (\w+) \{/gm)].map(m => m[1]);
  assert.deepEqual([...Object.keys(transitionManifest.models), ...transitionManifest.deferredModels].sort(), allModels.sort());
  assert.equal(transitionManifest.deferredModels.length, 31);
  for (const [name, model] of Object.entries(transitionManifest.models)) {
    const scalarNames = Object.keys(source()[name][0]);
    const storedNames = Object.keys(model.fields);
    assert.deepEqual(storedNames.sort(), scalarNames.sort());
  }
  fails(() => assertTransitionBaseline(schema + "\n", "{}", {}), "SCHEMA_DRIFT");
  fails(() => assertTransitionBaseline(schema, "{}", {}), "SCHEMA_DRIFT");
});

test("date-only/null/JSON null semantics are distinct; fixture encryption uses the unchanged Model.field context", () => {
  const data = source();
  const row = data.OperationSession[0];
  assert.equal(row.omName, null); // SQL NULL remains BSON null.
  const json = row.validationErrors as { __pii: string };
  const [, , key, nonce, tag, ciphertext] = json.__pii.split(":");
  // Public fixture keys only, no process.env or production privacy module import.
  const decipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 1), Buffer.from(nonce, "base64url"));
  decipher.setAAD(Buffer.from(`pii:v1:${key}:OperationSession.validationErrors`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString();
  assert.equal(plain, "null"); // Encrypted JSON null must NOT collapse to SQL NULL.
  assert.equal(row.specialNotesPiiIndex, createHmac("sha256", Buffer.alloc(32, 3)).update("OperationSession.specialNotes\0").digest("hex"));
  const mapped = mapOperationSlice(data, 25).collections.operation_sessions[0];
  assert.deepEqual(mapped.validationErrors, row.validationErrors);
  const copy = target(); copy.operation_sessions[0].validationErrors = null;
  fails(() => verifyOperationSlice(data, copy, 25), "ROW_MISMATCH");
  delete row.omName;
  fails(() => mapOperationSlice(data, 25), "FIELD_COVERAGE");
});

test("decimals reject unsafe values rather than silently rounding or using Number", () => {
  for (const [value, expected] of [["1", "1.00"], ["1.2", "1.20"], ["-0", "0.00"], ["-0.01", "-0.01"]]) assert.equal(decimal14_2(value), expected);
  for (const bad of [1.2, "1e2", "01.00", "1.001", "1000000000000.00", "NaN", "Infinity", " 1", "+1"]) fails(() => decimal14_2(bad), "INVALID_DECIMAL");
});

test("invalid dates, timestamps, enum/UUID/Int32 and array nulls fail closed", () => {
  const cases: Array<[string, string, unknown, string]> = [
    ["OperationSession", "startDate", "2026-02-30", "INVALID_DATE"],
    ["OperationSession", "startDate", "2026-09-21T00:00:00Z", "INVALID_DATE"],
    ["Company", "createdAt", "2026-09-21T00:00:00", "INVALID_DATE"],
    ["Company", "createdAt", "2026-09-21T00:00:00.000+09:00", "INVALID_DATE"],
    ["Company", "id", "not-a-uuid", "INVALID_UUID"],
    ["OperationSession", "operationStatus", "active", "INVALID_ENUM"],
    ["Course", "processSeq", 2147483648, "INVALID_INT32"],
    ["OperationSession", "educationDates", [null], "REQUIRED_NULL"]
  ];
  for (const [model, field, value, code] of cases) {
    const data = source(); data[model][0][field] = value as never;
    fails(() => mapOperationSlice(data, 25), code);
  }
});

test("nullable uniqueness permits multiple nulls; actual duplicate keys and row IDs fail", () => {
  const data = source();
  const second = structuredClone(data.OperationSession[0]);
  second.id = "00000000-0000-4000-8000-000000000099"; second.operationId = "fixture-second";
  data.OperationSession.push(second);
  assert.doesNotThrow(() => mapOperationSlice(data, 25));
  data.OperationSession[0].sourceFingerprint = second.sourceFingerprint = "fixture-fingerprint";
  fails(() => mapOperationSlice(data, 25), "DUPLICATE_KEY");
  const duplicate = source(); duplicate.Company.push(structuredClone(duplicate.Company[0]));
  fails(() => mapOperationSlice(duplicate, 25), "DUPLICATE_KEY");
  const duplicateTarget = target(); duplicateTarget.companies.push(structuredClone(duplicateTarget.companies[0]));
  fails(() => verifyOperationSlice(source(), duplicateTarget, 25), "ROW_COUNT_MISMATCH");
});

test("closed slice rejects orphan relations, dangling loose joins and unknown/missing model or fields", () => {
  for (const [model, field, value, code] of [
    ["Course", "companyId", "00000000-0000-4000-8000-000000000099", "ORPHAN_COURSE"],
    ["OperationSession", "courseRecordId", "00000000-0000-4000-8000-000000000099", "ORPHAN_SESSION"],
    ["CalendarEventLink", "operationId", "missing", "DANGLING_CALENDAR_LINK"]
  ]) { const data = source(); data[model][0][field] = value; fails(() => mapOperationSlice(data, 25), code); }
  const extra = source(); extra.Coach = [];
  fails(() => mapOperationSlice(extra, 25), "MODEL_COVERAGE");
  const missing = source(); delete missing.Course;
  fails(() => mapOperationSlice(missing, 25), "MODEL_COVERAGE");
  const field = source(); field.Course[0].futureSecret = "not-logged";
  fails(() => mapOperationSlice(field, 25), "FIELD_COVERAGE");
  fails(() => mapOperationSlice({ Company: [], Course: [], OperationSession: [], CalendarEventLink: [] }, 0), "EMPTY_SLICE");
});

test("PII stored fields require envelopes/companions and do not import Prisma null sentinels", () => {
  for (const [field, value, code] of [
    ["omName", "SENSITIVE-SENTINEL", "INVALID_ENVELOPE"],
    ["validationErrors", { __pii: "not-encrypted" }, "INVALID_ENVELOPE"],
    ["validationErrors", { _getName: "JsonNull" }, "INVALID_ENCRYPTED_JSON"],
    ["specialNotesPiiIndex", null, "HMAC_NULL_MISMATCH"]
  ] as const) { const data = source(); data.OperationSession[0][field] = value; fails(() => mapOperationSlice(data, 25), code); }
});

test("independent target comparison catches altered fields, types, arrays, extra fields and wrong identifiers", () => {
  for (const change of [
    (data: TransitionTarget) => { data.courses[0].revenue = 999999999999.99; },
    (data: TransitionTarget) => { data.courses[0].processSeq = 17; },
    (data: TransitionTarget) => { data.operation_sessions[0].educationDates = [{ $date: { $numberLong: "1709510400000" } }]; },
    (data: TransitionTarget) => { data.companies[0].name = "changed"; },
    (data: TransitionTarget) => { data.companies[0].unexpected = null; },
    (data: TransitionTarget) => { data.calendar_event_links[0].calendarIdPiiIndex = "a".repeat(64); }
  ]) { const data = target(); change(data); fails(() => verifyOperationSlice(source(), data, 25), "ROW_MISMATCH"); }
  const missing = target(); missing.courses = [];
  fails(() => verifyOperationSlice(source(), missing, 25), "ROW_COUNT_MISMATCH");
});

test("row ordering is ignored but duplicate target IDs are not collapsed", () => {
  const input = source(); const expected = target();
  const id = "00000000-0000-4000-8000-000000000098";
  input.Company.push({ ...input.Company[0], id, name: "Other fixture", normalizedName: "otherfixture" });
  expected.companies.unshift({ ...expected.companies[0], _id: id, name: "Other fixture", normalizedName: "otherfixture" });
  assert.equal(verifyOperationSlice(input, expected, 25).equivalent, true);
  expected.companies[0]._id = expected.companies[1]._id;
  fails(() => verifyOperationSlice(input, expected, 25), "DUPLICATE_TARGET_ID");
});

test("source sequence state is explicit, above every row, and must have room for the next Int32", () => {
  fails(() => mapOperationSlice(source(), undefined), "INVALID_SEQUENCE_HIGH_WATER");
  fails(() => mapOperationSlice(source(), 16), "SEQUENCE_BELOW_EXISTING");
  fails(() => mapOperationSlice(source(), 2147483647), "INVALID_SEQUENCE_HIGH_WATER");
});

test("CLI errors print stable codes only, not input paths/values; --help has no required env", () => {
  const command = ["--experimental-strip-types", "--experimental-loader", "./scripts/ts-loader.mjs", "scripts/check-mongodb-transition.ts"];
  const cleanEnv = { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", NODE_ENV: "test" as const };
  const run = spawnSync(process.execPath, [...command, "--schema", "/SENSITIVE-SENTINEL", "--privacy-policy", "missing", "--runtime-root", ".", "--source", "missing", "--target", "missing", "--sequence-high-water", "25"], { encoding: "utf8", env: cleanEnv });
  assert.equal(run.status, 1); assert.equal(run.stderr.includes("SENSITIVE-SENTINEL"), false);
  assert.equal(JSON.parse(run.stderr).code, "INPUT_READ_OR_JSON_ERROR");
  const help = spawnSync(process.execPath, [...command, "--help"], { encoding: "utf8", env: cleanEnv });
  assert.equal(help.status, 0); assert.match(help.stdout, /--sequence-high-water/);
});
