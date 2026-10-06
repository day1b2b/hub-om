/** V1–V3. Parent owns execution. Only coach storage is native; adjacent ports are synthetic.
 * No production environment loader. UI leaves/auth session supply/external source seams only.
 * Observer proxies delegate every coach call unchanged to an actual MongoCoachRepository.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import ts from "typescript";
import { MongoClient } from "mongodb";
import type { CoachRepository } from "./coachRepository";
import type { CoachSummary } from "./coachTypes";
import type { DataRepositories } from "./dataRepositoryContext";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { InstructorNote } from "./instructorNoteRepository";
import type { OperationSession } from "./operationTypes";
import { MongoCoachRepository } from "./mongoCoachRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { MONGO_COACH_PUBLIC_RUNTIME_MODELS, prepareMongoCoachPublicRuntime } from "./mongoCoachPublicRuntime";
import { COACH_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { coachFixtureRow, mongoCoachFixtures } from "./mongoCoachFixtures";

type Actor = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Actor | null>();
const admin: Actor = { user: { email: "public-page-admin@day1company.co.kr", name: "Synthetic admin" }, expires: "" };
const ordinary: Actor = { ...admin, user: { email: "public-page-user@day1company.co.kr", name: "Synthetic user" } };
let pgCalls = 0, externalCalls = 0, adjacentCalls = 0;
let holidayFails = false;
const holidayCalls: string[] = [];
const holidays = { "2099-12-25": "Synthetic holiday" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PUBLIC_PAGE_PG_TRIPWIRE"); } } });
mock.module("@/lib/holidayApi", { namedExports: { fetchKoreanHolidays: async (month: string) => {
  holidayCalls.push(month);
  if (holidayFails) throw new Error("SYNTHETIC_HOLIDAY_FAILURE");
  return structuredClone(holidays);
} } });
// Keep readOperationCollaboration and all page/model helpers real. Substitute its IO ports.
mock.module("@/lib/sourceReads", { namedExports: { getOperationSourceReader: async () => ({
  readDiscussionReferences: async () => ({ status: "disabled", items: [], issues: [] })
}) } });
const forbiddenSource = async () => { externalCalls++; throw new Error("PUBLIC_PAGE_EXTERNAL_TRIPWIRE"); };
mock.module("@/lib/sourceReads/manualEmailDiscussionArchiveReader", { namedExports: {
  hasManualEmailDiscussionArchiveConfig: () => false, readManualEmailOperationDiscussionReferences: forbiddenSource
} });
mock.module("@/lib/sourceReads/slackDiscussionReader", { namedExports: {
  hasSlackDiscussionConfig: () => false, readSlackOperationDiscussionReferences: forbiddenSource,
  readSlackOperationReportReferences: forbiddenSource
} });
const leaves = new Map([
  ["@/features/coaches/CoachList", "CoachList"],
  ["@/features/coaches/CoachScheduleBoard", "CoachScheduleBoard"],
  ["@/features/coaches/CoachDetail", "CoachDetailView"],
  ["@/features/coaches/CoachEngagementList", "CoachEngagementList"],
  ["@/features/wiki/InstructorWiki", "InstructorWiki"],
  ["@/features/wiki/InstructorWikiDetail", "InstructorWikiDetail"],
  ["@/features/operations/OperationDetail", "OperationDetail"]
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const name = leaves.get(specifier);
    if (name) return { url: `data:text/javascript,export function ${name}(){return null;}`, shortCircuit: true };
    return next(specifier === "next/navigation" || specifier === "next/server" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022
      } }).outputText };
    return next(url, context);
  }
});
const { getCoachRepository } = await import("./coachRepositoryFactory");
const { PrismaCoachRepository } = await import("./prismaCoachRepository");
const { default: listPage } = await import("../../app/coaches/page");
const { default: schedulePage } = await import("../../app/coaches/schedule/page");
const { default: detailPage } = await import("../../app/coaches/[id]/page");
const { default: engagementsPage } = await import("../../app/coaches/[id]/engagements/page");
const { default: wikiPage } = await import("../../app/instructor-wiki/page");
const { default: wikiDetailPage } = await import("../../app/instructor-wiki/[id]/page");
const { default: operationPage } = await import("../../app/operations/[operationId]/page");
hooks.deregister();

function props(element: ReactElement) { return element.props as Record<string, unknown>; }
const query = (value: Record<string, string | string[] | undefined> = {}) => ({ searchParams: Promise.resolve(value) });
const param = (id: string) => ({ params: Promise.resolve({ id }) });
const missingScope = /DATA_REPOSITORY_NOT_CONFIGURED: coach$/;
const range = { from: "2099-12-01", to: "2099-12-31" };
function noForbidden(pg = pgCalls, outside = externalCalls) {
  assert.equal(pg, 0, "PUBLIC_PAGE_PG_ACCESS"); assert.equal(outside, 0, "PUBLIC_PAGE_EXTERNAL_ACCESS");
}
function navigation(error: unknown, digest: string) {
  assert.equal((error as { digest?: string }).digest, digest); return true;
}
const notFound = (error: unknown) => navigation(error, "NEXT_HTTP_ERROR_FALLBACK;404");
const redirect = (path: string) => (error: unknown) => navigation(error, `NEXT_REDIRECT;replace;${path};307;`);
function saveEnv(names: string[]) {
  const saved = new Map(names.map(name => [name, process.env[name]]));
  return () => { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
}

type FactoryLedger = { databaseUrlReads: number; overrideCalls: number; prismaConstructions: number };
function evaluateFactorySource(source: string, scope: CoachRepository | undefined, databaseUrl?: string) {
  const ledger: FactoryLedger = { databaseUrlReads: 0, overrideCalls: 0, prismaConstructions: 0 };
  const executable = ts.transpileModule(
    source.replace(/^import .*;\n/gm, "").replace("export function", "function"),
    { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const environment = new Proxy(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }, {
    get(target, name, receiver) {
      if (name === "DATABASE_URL") ledger.databaseUrlReads++;
      return Reflect.get(target, name, receiver);
    }
  });
  class ObservedPrismaCoachRepository { constructor() { ledger.prismaConstructions++; } }
  const factory = new Function("process", "getDataRepositoryOverride", "PrismaCoachRepository",
    `${executable}\nreturn getCoachRepository;`)(
      { env: environment },
      (name: string) => { ledger.overrideCalls++; assert.equal(name, "coach"); return scope; },
      ObservedPrismaCoachRepository
    ) as () => CoachRepository;
  return { factory, ledger };
}
function assertScopedFactoryHasNoPg(source: string) {
  const sentinel = Object.freeze({}) as CoachRepository;
  const observed = evaluateFactorySource(source, sentinel, "postgresql://must-not-be-read");
  assert.equal(observed.factory(), sentinel);
  assert.deepEqual(observed.ledger, { databaseUrlReads: 0, overrideCalls: 1, prismaConstructions: 0 });
}

test("coach public factory source: scoped path reads no PG env and constructs no Prisma adapter", () => {
  const source = readFileSync(fileURLToPath(new URL("./coachRepositoryFactory.ts", import.meta.url)), "utf8");
  assertScopedFactoryHasNoPg(source);
  const defaultPath = evaluateFactorySource(source, undefined, "postgresql://synthetic");
  assert.ok(defaultPath.factory());
  assert.deepEqual(defaultPath.ledger, { databaseUrlReads: 1, overrideCalls: 1, prismaConstructions: 1 });
  const missingUrl = evaluateFactorySource(source, undefined);
  assert.throws(missingUrl.factory, /DATABASE_URL is required/);
  assert.deepEqual(missingUrl.ledger, { databaseUrlReads: 1, overrideCalls: 1, prismaConstructions: 0 });

  const beforeOverride = "  const scoped = getDataRepositoryOverride(\"coach\");";
  assert.throws(() => assertScopedFactoryHasNoPg(source.replace(beforeOverride,
    `  void process.env.DATABASE_URL;\n${beforeOverride}`)), /databaseUrlReads/);
  assert.throws(() => assertScopedFactoryHasNoPg(source.replace(beforeOverride,
    `  new PrismaCoachRepository();\n${beforeOverride}`)), /prismaConstructions/);
});

test("coach public factory: original URL guard, override-first, missing/nested/concurrent scopes", async () => {
  const restore = saveEnv(["DATABASE_URL", "MONGODB_URI"]);
  try {
    process.env.DATABASE_URL = "postgresql://synthetic@127.0.0.1:1/unreachable";
    assert.ok(getCoachRepository() instanceof PrismaCoachRepository); noForbidden();
    delete process.env.DATABASE_URL;
    process.env.MONGODB_URI = "mongodb://127.0.0.1:1/";
    assert.throws(getCoachRepository, /^Error: DATABASE_URL is required to access the coach repository\.$/);
    // Identity-only sentinels: no coach behavior is replaced in any page test.
    const a = Object.freeze({}) as CoachRepository, b = Object.freeze({}) as CoachRepository;
    runWithDataRepositories({ coach: a }, () => {
      assert.equal(getCoachRepository(), a);
      assert.throws(() => runWithDataRepositories({}, getCoachRepository), missingScope);
      assert.equal(getCoachRepository(), a);
      assert.throws(() => runWithDataRepositories({ coach: b }, () => {
        assert.equal(getCoachRepository(), b); throw new Error("SYNTHETIC_NESTED_FAILURE");
      }), /SYNTHETIC_NESTED_FAILURE/);
      assert.equal(getCoachRepository(), a);
    });
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const pending = runWithDataRepositories({ coach: a }, async () => { await barrier; assert.equal(getCoachRepository(), a); });
    await runWithDataRepositories({ coach: b }, async () => { release(); await pending; assert.equal(getCoachRepository(), b); });
    process.env.DATABASE_URL = "postgresql://synthetic@127.0.0.1:1/unreachable";
    assert.ok(getCoachRepository() instanceof PrismaCoachRepository); noForbidden();
    // Negative control: listPage swallows the PG tripwire, but the OUTSIDE checker catches it.
    const before = pgCalls;
    const envRestore = saveEnv(["ADMIN_EMAILS", "DEV_AUTH_BYPASS"]);
    try {
      process.env.ADMIN_EMAILS = admin.user.email; delete process.env.DEV_AUTH_BYPASS;
      assert.deepEqual(props(await actors.run(admin, listPage)), { coaches: [], loadFailed: true });
      assert.equal(pgCalls - before, 1);
      assert.throws(() => noForbidden(pgCalls - before, 0), /PUBLIC_PAGE_PG_ACCESS/);
    } finally { pgCalls = before; envRestore(); }
  } finally { restore(); }
});

function operationFixture(): OperationSession {
  return {
    id: "synthetic-operation", operationId: "synthetic-operation", sourceTeam: "1팀", courseId: "SYNTHETIC-COURSE",
    courseIdLabel: "", companyName: "Synthetic company", courseName: "Synthetic course", courseCategory: "", tools: "",
    om: "", ld: "", onsiteOm: "", operationStatus: "배정필요", archiveStatus: "아카이빙전", educationFormat: "오프라인",
    educationFormatRaw: "", operationChannel: "onsite", operationType: "특강", operationTypeRaw: "", roundNo: "1",
    educationDays: "1", educationDates: ["2099-12-01"], startDate: "2099-12-01", endDate: "2099-12-01",
    operationMonth: "2099-12", sessionDurationDays: 1, sessionDurationType: "특강", timeText: "", instructors: "", coach: "",
    region: "", onsiteRequired: "N", onsiteText: "", specialNotes: "", operationIssue: "", omUpdate: "", driveLink: "",
    operationDetail: "", companyWikiLink: "", instructorWikiLink: "", revenue: null, costRaw: "", profitRaw: "", totalCost: null,
    instructorCost: null, operationCost: null, profit: null, avgSatisfaction: "", instructorSatisfaction: "",
    hasSatisfactionSurvey: "확인필요", hasResultReport: "확인필요", resultReportLink: "", lectureManagementLink: "",
    lectureManagementNote: "", padletLink: "", validationStatus: "정상", validationErrors: []
  };
}
const operation = operationFixture();
const notes: InstructorNote[] = [{ instructorName: "가상 가", notionNo: 7, notion: { categories: ["Synthetic category"] } }];
function adjacent(noteRows = notes): Partial<DataRepositories> {
  const read = <T,>(value: T) => { adjacentCalls++; return structuredClone(value); };
  const unexpected = () => { adjacentCalls++; throw new Error("UNEXPECTED_ADJACENT_METHOD"); };
  return {
    operations: { listOperations: async () => read([operation]), findCoursesByCourseId: unexpected,
      findCoursesByCompany: unexpected, getOperationById: unexpected, getOperationCreatedAt: unexpected,
      createOperation: unexpected, updateOperation: unexpected, deleteOperation: unexpected, getSummary: unexpected },
    instructorNote: { listNotes: async () => read(noteRows), getNote: async name => read(noteRows.find(n => n.instructorName === name) ?? {}),
      getNoteByNotionNo: async no => read(noteRows.find(n => n.notionNo === no) ?? {}), saveNote: unexpected, saveNoteByNotionNo: unexpected },
    teamMembers: { listResourceOwners: async () => read({}), listRoleRosters: async () => read({ ld: {}, om: {} }) },
    teamUsers: { listTeamUsers: async () => read([]), findTeamUsersByEmail: unexpected, createTeamUser: unexpected,
      deleteTeamUsers: unexpected, updateTeamUserTeam: unexpected, updateTeamUsersRole: unexpected },
    omCustomTools: { list: () => read([]), add: unexpected }
  };
}
type Call = { scope: string; method: string; args: unknown[] };
function observe(repo: MongoCoachRepository, scope: string, calls: Call[]): CoachRepository {
  return new Proxy(repo, { get(target, name, receiver) {
    const value: unknown = Reflect.get(target, name, receiver);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => { calls.push({ scope, method: String(name), args: structuredClone(args) }); return Reflect.apply(value, target, args); };
  } });
}
function seedFixture() {
  const fixture = mongoCoachFixtures();
  for (const row of fixture.data.get("Coach")!) Object.assign(row, { workType: null, notionPageId: null,
    returnDate: null, availabilityDetail: null, dxTag: null });
  fixture.a.name = " 가상 가 "; fixture.b.name = "가상 가";
  const inactive = fixture.data.get("Coach")![3]; inactive.name = "가상 나"; inactive.displayOrder = 2;
  const blank = coachFixtureRow("Coach", { name: "  ", normalizedName: "synthetic-blank", sourceCoachId: "synthetic-blank",
    status: "INACTIVE", isActive: false, displayOrder: 3, workType: null, notionPageId: null });
  fixture.data.get("Coach")!.push(blank);
  for (const row of fixture.data.get("CoachEngagement")!) Object.assign(row, {
    operationSessionId: null, startTime: null, endTime: null, rehire: null,
    feedback: row.courseName === "Synthetic first" ? "Synthetic feedback" : null
  });
  return { ...fixture, inactive, blank };
}
function expected(f: ReturnType<typeof seedFixture>) {
  const summary = (id: unknown, name: string, active: boolean, fields: string[], rating: number | null, days: number): CoachSummary => ({
    id: id as string, name, workType: null, status: active ? "active" : "inactive", isActive: active, deletedAt: null,
    fields, avgRating: rating, workDayCount: days, notionPageId: null
  });
  const summaries = [summary(f.a.id, " 가상 가 ", true, ["Synthetic field"], 3, 1), summary(f.b.id, "가상 가", true, [], null, 0),
    summary(f.inactive.id, "가상 나", false, [], null, 0), summary(f.blank.id, "  ", false, [], null, 0)];
  const detail = { ...summaries[0], curriculums: ["Synthetic curriculum"], coachInputUrl: null, statusNote: "latest",
    returnDate: "2100-01-01", availabilityDetail: "Synthetic available", dxTag: "Synthetic DX" };
  const e = f.data.get("CoachEngagement")!;
  const engagements = [
    { id: e[1].id, courseName: "Synthetic second", operationSessionId: null, status: "completed", source: "sheet",
      startDate: "2099-12-31", endDate: "2099-12-31", startTime: null, endTime: null, rating: 2, rehire: null, feedback: null },
    { id: e[2].id, courseName: "Synthetic cancelled", operationSessionId: null, status: "cancelled", source: "sheet",
      startDate: "2099-12-02", endDate: "2099-12-02", startTime: null, endTime: null, rating: null, rehire: null, feedback: null },
    { id: e[0].id, courseName: "Synthetic first", operationSessionId: null, status: "scheduled", source: "manual",
      startDate: "2099-12-01", endDate: "2099-12-01", startTime: null, endTime: null, rating: 4, rehire: null, feedback: "Synthetic feedback" }
  ];
  const schedules = [
    { id: f.data.get("CoachSchedule")![0].id, date: "2099-12-01", startTime: "09:00", endTime: "18:00" },
    { id: f.data.get("CoachSchedule")![1].id, date: "2099-12-31", startTime: "09:00", endTime: "18:00" }
  ];
  const engagementSchedules = [
    { id: f.data.get("CoachEngagementSchedule")![0].id, engagementId: e[0].id, courseName: "Synthetic first", date: "2099-12-01", startTime: "09:00", endTime: "10:00" },
    { id: f.data.get("CoachEngagementSchedule")![1].id, engagementId: e[0].id, courseName: "Synthetic first", date: "2099-12-01", startTime: "10:00", endTime: "11:00" }
  ];
  const dayA = { id: f.a.id, name: " 가상 가 ", workType: null, fields: ["Synthetic field"], avgRating: null,
    recentEngagements: [{ courseName: "Synthetic second", endDate: "2099-12-31" }, { courseName: "Synthetic cancelled", endDate: "2099-12-02" }], engagementCount: 3 };
  const dashboard = { yearMonth: "2099-12", totalActiveCoaches: 2, days: {
    "2099-12-01": { date: "2099-12-01", coaches: [
      { ...dayA, schedules: [{ startTime: "13:00", endTime: "18:00" }], reservation: { reservedByName: "Synthetic reserver", reservedByEmail: "synthetic@example.invalid" } },
      { id: f.b.id, name: "가상 가", workType: null, fields: [], avgRating: null, recentEngagements: [], engagementCount: 0,
        schedules: [{ startTime: "09:00", endTime: "18:00" }], reservation: null }
    ] },
    "2099-12-31": { date: "2099-12-31", coaches: [{ ...dayA, schedules: [{ startTime: "09:00", endTime: "18:00" }], reservation: null }] }
  } };
  const lastCoach = { coachId: f.b.id, status: "active", workType: null, fields: [], avgRating: null, curriculums: [] };
  const firstCoach = { coachId: f.a.id, status: "active", workType: null, fields: ["Synthetic field"], avgRating: 3, curriculums: ["Synthetic curriculum"] };
  const wikiBase = { name: "가상 가", companies: [], courseCount: 0, courses: [], categories: ["Synthetic category"], notionNo: 7 };
  return { summaries, detail, engagements, schedules, engagementSchedules, dashboard, lastCoach, firstCoach, wikiBase };
}
const collaboration = { changeHistory: [], changeHistoryStatus: "disabled", discussionDiagnostics: { emailCandidateCount: 0, emailMatchedCount: 0 },
  discussionEmailCandidates: [], discussionIssues: [], discussionReferences: [], discussionSourceAvailability: { emailEnabled: false, slackEnabled: false },
  discussionStatus: "disabled", lectureReports: [], lectureReportStatus: "disabled" };
function operationProps(coachOptions: string[]) {
  return { coachOptions, collaboration, extraTools: [], instructorOptions: ["가상 가"], onsiteOmOptions: [], operation,
    personOptions: { ld: [], om: [] }, relatedOperations: [operation], sameCourseIdOperations: [operation], teamScope: "both" };
}

const uri = process.env.MONGODB_COACH_PUBLIC_PAGES_TEST_URI;
test("coach public pages: seven actual pages use native coach storage with preserved auth, errors and DTOs", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "/" || url.pathname === "");
  for (const key of url.searchParams.keys()) assert.ok(["replicaSet", "directConnection"].includes(key));
  const restore = saveEnv(["DATABASE_URL", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "SKILLFLO_COACH_URL_TEMPLATE", "COACH_PUBLIC_BACKEND", "MONGODB_URI", "MONGODB_SHADOW_DATABASE", "MONGODB_SHADOW_NAMESPACE"]);
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const databaseName = `hub_om_shadow_coach_pages_${randomBytes(10).toString("hex")}`;
  let owned = false, reading = false;
  const commands: string[] = [], calls: Call[] = [];
  client.on("commandStarted", event => { if (reading) commands.push(event.commandName); });
  const fetchPatch = mock.method(globalThis, "fetch", async () => { externalCalls++; throw new Error("PUBLIC_PAGE_FETCH_TRIPWIRE"); });
  try {
    delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS; delete process.env.SKILLFLO_COACH_URL_TEMPLATE;
    Object.assign(process.env, { ADMIN_EMAILS: admin.user.email, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
      PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
    await client.connect();
    assert.ok((await client.db("admin").command({ hello: 1 })).setName, "Replica set required");
    assert.ok(!(await client.db("admin").admin().listDatabases({ nameOnly: true })).databases.some(db => db.name === databaseName));
    owned = true;
    const f = seedFixture(), exp = expected(f);
    const options = (namespace: string) => ({ client, databaseName, namespace });
    for (const namespace of ["shadow_a", "shadow_b", "shadow_empty", "shadow_broken"]) {
      await prepareMongoReadStore({ ...options(namespace), allowShadowWrites: true }, COACH_READ_MODELS);
      if (namespace === "shadow_empty") continue;
      const store = new MongoOperationStore(options(namespace), COACH_READ_MODELS);
      for (const [model, rows] of f.data) {
        if (namespace === "shadow_broken" && model === "CoachFieldMaster") continue;
        const seeded = rows.map(row => namespace === "shadow_b" && model === "Coach" ? { ...row, name: `B:${row.name}` } : row);
        await store.collection(model).insertMany(seeded.map(row => encodeMongoRuntimeDocument(model, row)));
      }
      if (namespace === "shadow_broken") {
        // b has no broken tags: getCoachById succeeds; a subsequent schedule relation fails.
        await store.collection("CoachEngagementSchedule").insertOne(encodeMongoRuntimeDocument("CoachEngagementSchedule",
          coachFixtureRow("CoachEngagementSchedule", { coachId: f.b.id, engagementId: randomUUID(), date: new Date("2099-12-01"), startTime: "12:00", endTime: "13:00" })));
      }
    }
    await prepareMongoCoachPublicRuntime({ ...options("shadow_composition"), allowShadowWrites: true, processSequenceHighWater: 1 });
    const compositionStore = new MongoOperationStore(options("shadow_composition"), MONGO_COACH_PUBLIC_RUNTIME_MODELS);
    for (const [model, rows] of f.data) {
      await compositionStore.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    }
    reading = true;
    const a = observe(await MongoCoachRepository.open(options("shadow_a")), "a", calls);
    const b = observe(await MongoCoachRepository.open(options("shadow_b")), "b", calls);
    const empty = observe(await MongoCoachRepository.open(options("shadow_empty")), "empty", calls);
    const broken = observe(await MongoCoachRepository.open(options("shadow_broken")), "broken", calls);
    const run = <T,>(repo: CoachRepository | undefined, work: () => T, actor: Actor | null = admin, noteRows = notes) =>
      runWithDataRepositories({ ...adjacent(noteRows), ...(repo ? { coach: repo } : {}) }, () => actors.run(actor, work));
    const detail = (id = f.a.id as string) => detailPage({ ...param(id), ...query({ tab: ["schedule", "profile"], month: ["2099-12", "bad"] }) });
    const board = () => schedulePage(query({ yearMonth: ["2099-12", "bad"], date: ["2099-12-99", "ignored"] }));
    const op = () => operationPage({ params: Promise.resolve({ operationId: operation.operationId }), ...query() });
    const seven = [listPage, board, detail, () => engagementsPage(param(f.a.id as string)), wikiPage, () => wikiDetailPage(param("7")), op];
    const expectCalls = (scope: string, entries: [string, unknown[]][]) => {
      assert.deepEqual(calls.splice(0), entries.map(([method, args]) => ({ scope, method, args }))); noForbidden();
    };
    await suite.test("real guards reject before all reads; workspace user may access only the operation page", async () => {
      for (const actor of [null, { ...ordinary, user: { ...ordinary.user, email: "outsider@example.invalid" } }, ordinary]) {
        for (const [index, page] of seven.entries()) {
          if (actor === ordinary && index === 6) continue;
          const previous = adjacentCalls, holidayCount = holidayCalls.length, commandCount = commands.length;
          await assert.rejects(run(a, page, actor), redirect(index === 6 ? "/sign-in" : "/dashboard"));
          assert.equal(adjacentCalls, previous); assert.equal(holidayCalls.length, holidayCount); assert.equal(commands.length, commandCount);
          expectCalls("a", []);
        }
      }
    });
    await suite.test("native list normal/empty and synchronous missing factory", async () => {
      assert.deepEqual(props(await run(a, listPage)), { coaches: exp.summaries, loadFailed: false }); expectCalls("a", [["listCoaches", []]]);
      assert.deepEqual(props(await run(empty, listPage)), { coaches: [], loadFailed: false }); expectCalls("empty", [["listCoaches", []]]);
      assert.deepEqual(props(await run(undefined, listPage)), { coaches: [], loadFailed: true }); expectCalls("a", []);
    });
    await suite.test("actual selector opens prepared runtime after auth and never repairs a partial namespace", async () => {
      Object.assign(process.env, { COACH_PUBLIC_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName,
        MONGODB_SHADOW_NAMESPACE: "shadow_composition" });
      try {
        const snapshot = async (namespace: string) => {
          const collections = await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray();
          const selected = collections.filter(row => row.name.startsWith(`${namespace}__`)).sort((a, b) => a.name.localeCompare(b.name));
          return Promise.all(selected.map(async row => ({ definition: row, indexes: await client.db(databaseName).collection(row.name).indexes(),
            documents: await client.db(databaseName).collection(row.name).find({}).sort({ _id: 1 }).toArray() })));
        };
        const compositionBefore = await snapshot("shadow_composition");
        assert.deepEqual(props(await actors.run(admin, listPage)), { coaches: exp.summaries, loadFailed: false });
        assert.deepEqual(props(await actors.run(admin, board)), { currentUserEmail: admin.user.email, dashboard: exp.dashboard, holidays,
          initialDate: "2099-12-99", loadFailed: false });
        assert.deepEqual(props(await actors.run(admin, detail)), { coach: exp.detail, engagements: exp.engagements, schedules: exp.schedules,
          engagementSchedules: exp.engagementSchedules, selectedMonth: "2099-12", selectedTab: "schedule" });
        assert.deepEqual(props(await actors.run(admin, () => engagementsPage(param(f.a.id as string)))), {
          coachId: f.a.id, coachName: " 가상 가 ", engagements: exp.engagements, feedbackByEngagement: {} });
        assert.deepEqual(props(await actors.run(admin, wikiPage)), { entries: [], loadFailed: false, operationEntryCount: 0,
          provenance: "empty", recruitAvoidNames: [] });
        await assert.rejects(actors.run(admin, () => wikiDetailPage(param("missing"))), notFound);
        assert.deepEqual(await snapshot("shadow_composition"), compositionBefore);
        noForbidden();

        process.env.MONGODB_URI = "mongodb://127.0.0.1:1/";
        await assert.rejects(actors.run(null, listPage), redirect("/dashboard"));
        process.env.MONGODB_URI = uri!;

        const before = await snapshot("shadow_broken");
        process.env.MONGODB_SHADOW_NAMESPACE = "shadow_broken";
        await assert.rejects(actors.run(admin, listPage), /COACH_PUBLIC_COMPOSITION_FAILED/);
        assert.deepEqual(await snapshot("shadow_broken"), before);
      } finally {
        delete process.env.COACH_PUBLIC_BACKEND;
        delete process.env.MONGODB_URI;
        delete process.env.MONGODB_SHADOW_DATABASE;
        delete process.env.MONGODB_SHADOW_NAMESPACE;
      }
    });
    await suite.test("native schedule full DTO, async repository failure, sync factory failure and holiday failure", async () => {
      assert.deepEqual(props(await run(a, board)), { currentUserEmail: admin.user.email, dashboard: exp.dashboard, holidays,
        initialDate: "2099-12-99", loadFailed: false }); expectCalls("a", [["getScheduleDashboard", ["2099-12"]]]);
      const before = holidayCalls.length;
      await assert.rejects(run(undefined, board), missingScope); assert.equal(holidayCalls.length, before); expectCalls("a", []);
      assert.deepEqual(props(await run(broken, board)), { currentUserEmail: admin.user.email,
        dashboard: { yearMonth: "2099-12", totalActiveCoaches: 0, days: {} }, holidays, initialDate: "2099-12-99", loadFailed: true });
      expectCalls("broken", [["getScheduleDashboard", ["2099-12"]]]);
      holidayFails = true;
      try { assert.deepEqual(props(await run(a, board)), { currentUserEmail: admin.user.email, dashboard: exp.dashboard,
        holidays: {}, initialDate: "2099-12-99", loadFailed: false }); } finally { holidayFails = false; }
      expectCalls("a", [["getScheduleDashboard", ["2099-12"]]]);
    });
    await suite.test("native detail full DTO/range; missing coach stops followups; actual broken followup rejects", async () => {
      assert.deepEqual(props(await run(a, detail)), { coach: exp.detail, engagements: exp.engagements, schedules: exp.schedules,
        engagementSchedules: exp.engagementSchedules, selectedMonth: "2099-12", selectedTab: "schedule" });
      expectCalls("a", [["getCoachById", [f.a.id]], ["listEngagements", [f.a.id]], ["listSchedules", [f.a.id, range]], ["listEngagementSchedules", [f.a.id, range]]]);
      const missing = randomUUID();
      await assert.rejects(run(a, () => detail(missing)), notFound); expectCalls("a", [["getCoachById", [missing]]]);
      await assert.rejects(run(broken, () => detail(f.b.id as string)), /COACH_RELATION_MISSING/);
      expectCalls("broken", [["getCoachById", [f.b.id]], ["listEngagements", [f.b.id]], ["listSchedules", [f.b.id, range]], ["listEngagementSchedules", [f.b.id, range]]]);
    });
    await suite.test("native engagements full props, empty rows and notFound followups zero", async () => {
      assert.deepEqual(props(await run(a, () => engagementsPage(param(f.a.id as string)))), {
        coachId: f.a.id, coachName: " 가상 가 ", engagements: exp.engagements, feedbackByEngagement: {} });
      expectCalls("a", [["getCoachById", [f.a.id]], ["listEngagements", [f.a.id]]]);
      assert.deepEqual(props(await run(a, () => engagementsPage(param(f.b.id as string)))), {
        coachId: f.b.id, coachName: "가상 가", engagements: [], feedbackByEngagement: {} });
      expectCalls("a", [["getCoachById", [f.b.id]], ["listEngagements", [f.b.id]]]);
      const missing = randomUUID(); await assert.rejects(run(a, () => engagementsPage(param(missing))), notFound);
      expectCalls("a", [["getCoachById", [missing]]]);
    });
    await suite.test("native wiki list last trim match versus detail first match, with Notion-only course history", async () => {
      assert.deepEqual(props(await run(a, wikiPage)), { entries: [{ ...exp.wikiBase, id: "no-7", coach: exp.lastCoach }],
        loadFailed: false, operationEntryCount: 0, provenance: "notion", recruitAvoidNames: [] });
      expectCalls("a", [["listCoaches", []]]);
      assert.deepEqual(props(await run(a, () => wikiDetailPage(param("7")))), { entry: { ...exp.wikiBase, id: "가상 가", coach: exp.firstCoach } });
      expectCalls("a", [["listCoaches", []], ["getCoachById", [f.a.id]]]);
      const linked: InstructorNote[] = [
        { ...notes[0], notionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", notion: { ...notes[0].notion, syncedAt: "2099-12-02" } },
        { instructorName: "Synthetic alias", notionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ];
      await assert.rejects(run(a, () => wikiDetailPage(param("Synthetic%20alias")), admin, linked), redirect("/instructor-wiki/7")); expectCalls("a", []);
      await assert.rejects(run(a, () => wikiDetailPage(param("999"))), notFound); expectCalls("a", []);
      await assert.rejects(run(a, () => wikiDetailPage(param("%invalid"))), notFound); expectCalls("a", []);
    });
    await suite.test("native operation page preserves entire props and trim/dedupe/Korean option order", async () => {
      assert.deepEqual(props(await run(a, op, ordinary)), operationProps(["가상 가", "가상 나"]));
      expectCalls("a", [["listCoaches", []]]);
    });
    await suite.test("actual decode/relation failure or missing factory is swallowed only at existing boundaries", async () => {
      for (const repo of [undefined, broken]) {
        const scope = repo ? "broken" : "a";
        assert.deepEqual(props(await run(repo, listPage)), { coaches: [], loadFailed: true });
        expectCalls(scope, repo ? [["listCoaches", []]] : []);
        assert.deepEqual(props(await run(repo, wikiPage)), { entries: [{ ...exp.wikiBase, id: "no-7", coach: null }],
          loadFailed: false, operationEntryCount: 0, provenance: "notion", recruitAvoidNames: [] });
        expectCalls(scope, repo ? [["listCoaches", []]] : []);
        assert.deepEqual(props(await run(repo, () => wikiDetailPage(param("7")))), { entry: { ...exp.wikiBase, id: "가상 가", coach: null } });
        expectCalls(scope, repo ? [["listCoaches", []]] : []);
        assert.deepEqual(props(await run(repo, op)), operationProps([])); expectCalls(scope, repo ? [["listCoaches", []]] : []);
      }
    });
    await suite.test("same IDs across concurrent native namespaces never mix DTO or method identity", async () => {
      const results = await Promise.all([run(a, listPage), run(b, listPage)]);
      assert.deepEqual(props(results[0]), { coaches: exp.summaries, loadFailed: false });
      assert.deepEqual(props(results[1]), { coaches: exp.summaries.map(row => ({ ...row, name: `B:${row.name}` })), loadFailed: false });
      assert.deepEqual(calls.splice(0).sort((x, y) => x.scope.localeCompare(y.scope)), [
        { scope: "a", method: "listCoaches", args: [] }, { scope: "b", method: "listCoaches", args: [] }
      ]); noForbidden();
    });
    const stored = new MongoOperationStore(options("shadow_a"), COACH_READ_MODELS);
    const raw = JSON.stringify(await Promise.all(stored.models.map(model => stored.collection(model).find({}).toArray())));
    for (const canary of ["synthetic-profile@example.invalid", "010-0000-0000", "SYNTHETIC-ID", "Synthetic affiliation", "Synthetic private hirer", "synthetic@example.invalid"])
      assert.equal(raw.includes(canary), false, "STORED_PII_PLAINTEXT");
    const publicProps = JSON.stringify(props(await run(a, detail)));
    for (const canary of ["synthetic-profile@example.invalid", "Synthetic private hirer", '"accessToken"'])
      assert.equal(publicProps.includes(canary), false, "PRIVATE_FIELD_IN_PUBLIC_DTO");
    calls.length = 0;
    assert.ok(commands.includes("find"));
    const writes = new Set(["insert", "update", "delete", "create", "createIndexes", "collMod", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite"]);
    assert.deepEqual(commands.filter(command => writes.has(command)), []); noForbidden();
  } finally {
    reading = false;
    try { if (owned) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { fetchPatch.mock.restore(); restore(); } }
  }
});
