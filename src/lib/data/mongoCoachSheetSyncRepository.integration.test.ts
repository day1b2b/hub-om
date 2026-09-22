import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { Collection, Db, MongoClient, MongoServerError, type CommandStartedEvent } from "mongodb";
import { activityContext } from "../activity/context";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { CoachSheetSource } from "./coachSheetSyncRepository";
import { MongoCoachSheetSyncRepository, prepareMongoCoachSheetSyncStore, COACH_SHEET_SYNC_MODELS } from "./mongoCoachSheetSyncRepository";
import { MongoCoachSyncLogRepository, prepareMongoCoachSyncLogStore } from "./mongoCoachSyncLogRepository";
import { MongoCoachEngagementRepository, prepareMongoCoachEngagementStore, COACH_ENGAGEMENT_MODELS } from "./mongoCoachEngagementRepository";
import { MongoCoachScheduleRepository, prepareMongoCoachScheduleStore, COACH_SCHEDULE_MODELS } from "./mongoCoachScheduleRepository";
import { MongoCoachTokenRepository, prepareMongoCoachTokenStore, COACH_TOKEN_MODELS } from "./mongoCoachTokenRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoCoachManagementRepository, prepareMongoCoachManagementStore } from "./mongoCoachManagementRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { isEncrypted } from "../privacy/crypto";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const managerA: Session = { user: { email: "sheet-a@day1company.co.kr", name: "Synthetic Sheet Admin A" }, expires: "" };
const managerB: Session = { user: { email: "sheet-b@day1company.co.kr", name: "Synthetic Sheet Admin B" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("Unexpected PostgreSQL access"); } } });
let externalReads = 0;
mock.module("../coaches/googleServiceAccount", { namedExports: {
  readGoogleSpreadsheetRows: async () => { externalReads++; throw new Error("External Google source forbidden in native test"); },
  readGoogleSheetValues: async () => { externalReads++; throw new Error("External Google source forbidden in native test"); }
} });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const notionRoute = await import("../../app/api/admin/sync-notion/route");
const allSyncRoute = await import("../../app/api/sync/all/route");
const contractRoute = await import("../../app/api/sync/engagements/route");
const samsungRoute = await import("../../app/api/sync/samsung-schedule/route");
const engagementRoute = await import("../../app/api/coaches/[id]/engagements/route");
const managementRoute = await import("../../app/api/coaches/[id]/route");
const engagementItemRoute = await import("../../app/api/engagements/[id]/route");
const reviewRoute = await import("../../app/api/engagements/[id]/review/route");
const reservationRoute = await import("../../app/api/coaches/[id]/reservations/route");
const monthRoute = await import("../../app/api/coach/schedule/[yearMonth]/route");
hook.deregister();

const uri = process.env.MONGODB_COACH_SHEET_SYNC_TEST_URI;
const firstDay = "2099-12-10", secondDay = "2099-12-11";
const { SAMSUNG_COURSE_NAMES } = await import("../coaches/samsungScheduleSync");
const samsungName = SAMSUNG_COURSE_NAMES.courseName, oldSamsungName = SAMSUNG_COURSE_NAMES.oldCourseName;
const coachName = "Synthetic Sheet Coach", courseName = "Synthetic Sheet Course", privateMail = "private-sheet@example.invalid", privatePhone = "010-9876-5432";
function contractRow(name = coachName, course = courseName, start = firstDay, end = secondDay) {
  const row = Array<string>(17).fill(""); row[3] = "TEST123-1"; row[4] = name; row[5] = "실습코치"; row[6] = "Synthetic Sheet Hiring"; row[7] = course; row[9] = start; row[10] = end; row[12] = "09:00~18:00"; row[13] = privateMail; row[14] = privatePhone; return row;
}
function samsungRow(name = coachName, start = firstDay, end = secondDay) { const row = Array<string>(10).fill(""); row[2] = start; row[3] = end; row[6] = name; return row; }
function source(contract: string[][] = [], samsung: string[][] = [], struckCells = new Set<string>()): CoachSheetSource {
  return { readContract: async () => ({ values: [["header"], ...contract], struckCells }), readSamsung: async () => ({ rows: [["header"], ...samsung], contractRows: [] }) };
}
function request(path: string, method = "POST", body?: unknown, secret?: string) { return new Request(`https://example.invalid${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const sync = (kind: "contract" | "samsung", dry = false, secret?: string) => (kind === "contract" ? contractRoute : samsungRoute)[dry ? "GET" : "POST"](request(`/api/sync/${kind === "contract" ? "engagements" : "samsung-schedule"}`, dry ? "GET" : "POST", undefined, secret));
const reserve = (id: string) => reservationRoute.POST(request(`/api/coaches/${id}/reservations`, "POST", { dates: [firstDay] }), context(id));
const manualCreate = (id: string, course = courseName) => engagementRoute.POST(request(`/api/coaches/${id}/engagements`, "POST", { courseName: course, startDate: firstDay, endDate: secondDay, rating: null }), context(id));

/** Local synthetic fixtures only: no env-file discovery, production database or external source calls. */
test("actual sheet sync services and handlers against an isolated Mongo replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const databaseName = `hub_om_shadow_sheet_test_${randomBytes(12).toString("hex")}`, client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const envNames = ["PII_ENCRYPTION_KEYS","PII_ACTIVE_KEY_ID","PII_INDEX_KEY","PII_ALLOW_PLAINTEXT_READS","DATABASE_URL","DEV_AUTH_BYPASS","SYNC_API_SECRET","ADMIN_EMAILS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "sheet_fixture"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ sheet_fixture: randomBytes(32).toString("base64") }); process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  process.env.SYNC_API_SECRET = `synthetic-${randomBytes(16).toString("hex")}`; process.env.ADMIN_EMAILS = `${managerA.user.email},${managerB.user.email}`; delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_sheet_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCoachSheetSyncStore(options); await prepareMongoCoachSyncLogStore(options); await prepareMongoCoachEngagementStore(options); await prepareMongoCoachScheduleStore(options); await prepareMongoCoachTokenStore(options); await prepareMongoRequestAuditStore(options);
    const scope = { coachSheetSync: await MongoCoachSheetSyncRepository.open(options), coachSyncLog: await MongoCoachSyncLogRepository.open(options), coachSheetSource: source(), coachEngagement: await MongoCoachEngagementRepository.open(options), coachSchedule: await MongoCoachScheduleRepository.open(options), coachToken: await MongoCoachTokenRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options) };
    const store = new MongoOperationStore(options, [...new Set([...COACH_SHEET_SYNC_MODELS, ...COACH_ENGAGEMENT_MODELS, ...COACH_SCHEDULE_MODELS, ...COACH_TOKEN_MODELS, ...REQUEST_AUDIT_MODELS, "CoachSyncLog"])]);
    const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const coach = await seed("Coach", { name: coachName, normalizedName: "synthetic sheet coach", sourceCoachId: "synthetic:existing", status: "ACTIVE", isActive: true, accessToken: "synthetic-sheet-token", workType: "운영조교", managerNote: "Synthetic handwritten note" });
    const other = await seed("Coach", { name: "Synthetic Other Sheet Coach", normalizedName: "synthetic other sheet coach", sourceCoachId: "synthetic:other", status: "ACTIVE", isActive: true });
    const call = (input: CoachSheetSource, kind: "contract" | "samsung" = "contract", dry = false, actor: Session | null = managerA, secret?: string) => runWithDataRepositories({ ...scope, coachSheetSource: input }, () => actors.run(actor, () => sync(kind, dry, secret)));
    return { options, scope, store, seed, id: coach.id as string, otherId: other.id as string, call };
  }
  const businessModels = ["Coach","CoachPrivateProfile","CoachEngagement","CoachEngagementSchedule","CoachDayReservation","CoachSchedule","CoachScheduleAccessLog","CoachContentEntry","ActivityChange"];
  const snapshot = (store: MongoOperationStore, models = businessModels) => Promise.all(models.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()));
  // Hold one real catalog write inside its transaction, then demand a real conflicting call and retry.
  async function forceCatalogOrder(f: Awaited<ReturnType<typeof fixture>>, first: () => Promise<Response>, second: () => Promise<Response>, holdOrdinal = 1, guardKind = "CoachCatalogGuard") {
    const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
    const held = deferred(), conflict = deferred(), release = deferred(); let firstCount = 0, retries = 0, collisions = 0;
    const original = Collection.prototype.updateOne, guard = `${f.options.namespace}_${guardKind}`;
    const patch = mock.method(Collection.prototype, "updateOne", async function(this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      const relevant = this.collectionName === guard, actor = activityContext.getStore()?.actorEmail ?? actors.getStore()?.user.email;
      if (relevant && actor === managerB.user.email) retries++;
      try {
        const result = await original.apply(this, args);
        if (relevant && actor === managerA.user.email && ++firstCount === holdOrdinal) { held.resolve(); await release.promise; }
        return result;
      } catch (error) { if (relevant && actor === managerB.user.email && error instanceof MongoServerError && [112,11000].includes(Number(error.code))) { collisions++; conflict.resolve(); } throw error; }
    });
    const pending: Promise<Response>[] = [];
    const deadline = async (value: Promise<unknown>) => { let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([value, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Catalog race barrier deadline")), 8000); })]); } finally { clearTimeout(timer); } };
    try {
      const a = actors.run(managerA, first); pending.push(a); void a.catch(() => {}); await deadline(Promise.race([held.promise, a.then(() => { throw new Error("First request did not reach catalog guard"); })]));
      const b = actors.run(managerB, second); pending.push(b); void b.catch(() => {}); await deadline(Promise.race([conflict.promise, b.then(() => { throw new Error("Second request did not conflict on catalog guard"); })]));
      release.resolve(); const responses = await Promise.all(pending); assert.ok(collisions >= 1); assert.ok(retries >= 2); return responses;
    } finally { release.resolve(); held.resolve(); conflict.resolve(); await Promise.allSettled(pending); patch.mock.restore(); }
  }
  try {
    await client.connect(); connected = true;
    await suite.test("actual Notion and all-sync GET/POST fail at the scoped backend boundary before external reads or business writes", async () => {
      const f = await fixture(), before = await snapshot(f.store); let fetchCalls = 0, sheetReads = 0;
      const guardSnapshot = () => Promise.all(["CoachCatalogGuard","CoachSchedulingGuard"].map(name => f.store.db.collection(`${f.options.namespace}_${name}`).find({}).toArray()));
      const guards = await guardSnapshot();
      const input:CoachSheetSource = {
        readContract:async () => { sheetReads++; throw new Error("Sheet source must remain untouched by blocked all-sync"); },
        readSamsung:async () => { sheetReads++; throw new Error("Sheet source must remain untouched by blocked all-sync"); }
      };
      // The real handler requires Notion repositories before reading config, fetching, or logging a run.
      // This additional fence makes an accidental future ordering regression unable to reach the network.
      const fetchPatch = mock.method(globalThis,"fetch",async () => { fetchCalls++; throw new Error("External fetch forbidden in scoped Notion test"); });
      try {
        for(const [route,path] of [[notionRoute,"/api/admin/sync-notion"],[allSyncRoute,"/api/sync/all"]] as const) for(const method of ["GET","POST"] as const) {
          const response = await runWithDataRepositories({ ...f.scope,coachSheetSource:input },() => actors.run(managerA,() => route[method](request(path,method))));
          assert.equal(response.status,500); assert.deepEqual(await response.json(),{ ok:false,error:"DATA_REPOSITORY_NOT_CONFIGURED: coachNotionSync" });
          assert.deepEqual(await snapshot(f.store),before); assert.deepEqual(await guardSnapshot(),guards);
        }
      } finally { fetchPatch.mock.restore(); }
      assert.equal(fetchCalls,0); assert.equal(sheetReads,0); assert.equal(externalReads,0);
      const logs = await f.store.scan("CoachSyncLog",{}); assert.equal(logs.length,0);
      assert.equal(await f.store.collection("ActivityRequest").countDocuments({ status:500 }),4);
    });

    await suite.test("public read driver errors never expose their raw marker in real sync GET or POST responses", async () => {
      const f = await fixture(), marker = "SYNTHETIC_RAW_DRIVER_PRIVATE_MARKER_420a", original = Collection.prototype.find;
      const before = await snapshot(f.store);
      const patch = mock.method(Collection.prototype,"find",function(this:Collection,...args:Parameters<Collection["find"]>) {
        if(this.collectionName === f.store.collection("Coach").collectionName) throw new Error(marker);
        return original.apply(this,args);
      });
      try {
        for(const kind of ["contract","samsung"] as const) for(const dry of [true,false]) {
          const response = await f.call(source([contractRow()],[samsungRow()]),kind,dry); assert.equal(response.status,500);
          const body = await response.json(); assert.match(body.error,/^Mongo operation failed: COACH_SHEET_READ_FAILED$/); assert.ok(!JSON.stringify(body).includes(marker));
        }
      } finally { patch.mock.restore(); }
      assert.deepEqual(await snapshot(f.store),before);
      const logs = await f.store.scan("CoachSyncLog",{}); assert.equal(logs.length,2); assert.ok(logs.every(row => row.status === "failed" && !String(row.errorDetail).includes(marker)));
      const originalList = Db.prototype.listCollections;
      const openPatch = mock.method(Db.prototype,"listCollections",function(this:Db,...args:Parameters<Db["listCollections"]>) {
        if(this.databaseName === databaseName && args[0]?.name === f.store.collection("CoachSyncLog").collectionName) throw new Error(marker);
        return originalList.apply(this,args);
      });
      try { await assert.rejects(MongoCoachSyncLogRepository.open(f.options),(error:Error) => error.message === "Mongo operation failed: COACH_SYNC_LOG_OPEN_FAILED" && !error.message.includes(marker)); }
      finally { openPatch.mock.restore(); }
    });

    await suite.test("coach reader batches profiles and identity lookup uses an HMAC filter with live exact-name selection", async () => {
      const f = await fixture();
      await f.seed("CoachPrivateProfile",{ coachId:f.id,email:"target-profile@example.invalid" });
      for(let index=0;index<6;index++) {
        const row = await f.seed("Coach",{ name:`Synthetic batch ${index}`,normalizedName:`synthetic batch ${index}`,sourceCoachId:`synthetic:batch:${index}`,status:"ACTIVE",isActive:true });
        if(index%2===0) await f.seed("CoachPrivateProfile",{ coachId:row.id,email:`batch-${index}@example.invalid` });
      }
      await f.seed("Coach",{ name:coachName,normalizedName:"synthetic sheet coach",sourceCoachId:"synthetic:deleted-duplicate",status:"ACTIVE",isActive:true,deletedAt:new Date("2099-01-01") });
      const finds:Array<{ collection:string; filter:Record<string,unknown>; transactional:boolean }> = [];
      const observe = (event:CommandStartedEvent) => { if(event.commandName === "find" && event.databaseName === databaseName) finds.push({ collection:event.command.find,filter:event.command.filter,transactional:event.command.txnNumber !== undefined }); };
      client.on("commandStarted",observe);
      try {
        const coaches = await f.scope.coachSheetSync.listLiveCoaches(); assert.equal(coaches.length,8);
        assert.equal(coaches.find(row => row.id === f.id)?.privateProfile?.email,"target-profile@example.invalid");
        assert.equal(coaches.find(row => row.id === f.otherId)?.privateProfile,null);
        const profileFinds = finds.filter(row => row.collection === f.store.collection("CoachPrivateProfile").collectionName);
        assert.equal(profileFinds.length,1,"All live coaches must share a single profile query");
        assert.deepEqual((profileFinds[0].filter._id as { $in:string[] }).$in.sort(),coaches.map(row => row.id).sort());
        finds.length=0;
        const matched = await f.scope.coachSheetSync.findLiveCoachByName(coachName); assert.equal(matched?.id,f.id); assert.equal(matched?.name,coachName);
        const coachFinds = finds.filter(row => row.collection === f.store.collection("Coach").collectionName);
        assert.equal(coachFinds.length,1); assert.deepEqual(coachFinds[0].filter,{ namePiiIndex:mongoRuntimeBlindIndex("Coach","name",coachName) });
        assert.ok(!JSON.stringify(coachFinds[0].filter).includes(coachName));
        finds.length=0;
        const response = await f.call(source([contractRow()])); assert.equal(response.status,200);
        const transactionCoachFinds = finds.filter(row => row.transactional && row.collection === f.store.collection("Coach").collectionName);
        assert.ok(transactionCoachFinds.some(row => row.filter.namePiiIndex === mongoRuntimeBlindIndex("Coach","name",coachName)),"Real ensureCoach must query the name HMAC inside its transaction");
        assert.ok(transactionCoachFinds.every(row => row.filter.namePiiIndex !== undefined || row.filter._id !== undefined),"Identity transactions must not scan all coaches");
        assert.equal(await f.store.collection("CoachEngagement").countDocuments({ coachId:f.id }),1);
      } finally { client.off("commandStarted",observe); }
    });

    await suite.test("dry-run executes both source parsers without any business, guard or sync-log writes", async () => {
      const f = await fixture(); const before = await snapshot(f.store, [...businessModels,"CoachSyncLog"]);
      const guardSnapshot = async () => Promise.all(["CoachCatalogGuard","CoachSchedulingGuard"].map(name => f.store.db.collection(`${f.options.namespace}_${name}`).find({}).toArray()));
      const guards = await guardSnapshot();
      for (const kind of ["contract","samsung"] as const) {
        const response = await f.call(source([contractRow("Synthetic New Dry Coach")], [samsungRow("Synthetic New Dry Coach")]), kind, true); assert.equal(response.status, 200);
        const body = await response.json(); assert.equal(body.dryRun, true); assert.equal(body.result.created, 2); assert.ok(body.result.changes.length >= 2);
        assert.deepEqual(await snapshot(f.store, [...businessModels,"CoachSyncLog"]), before); assert.deepEqual(await guardSnapshot(), guards);
      }
      assert.equal(await f.store.collection("ActivityRequest").countDocuments(), 2);
    });

    await suite.test("real admin and synthetic bearer auth, missing scope and missing source fail without external reads", async () => {
      const f = await fixture();
      for (const actor of [null, { user: { email: "ordinary@day1company.co.kr", name: "Ordinary" }, expires: "" }]) assert.equal((await f.call(source([contractRow()]), "contract", false, actor)).status, 500);
      assert.equal((await f.call(source(), "contract", true, null, "wrong-synthetic-secret")).status, 500);
      assert.equal((await f.call(source(), "contract", true, null, process.env.SYNC_API_SECRET)).status, 200);
      for (const missing of ["coachSheetSync","coachSheetSource","coachSyncLog"] as const) {
        const scope = { ...f.scope }; delete (scope as Partial<typeof scope>)[missing];
        const response = await runWithDataRepositories(scope, () => actors.run(managerA, () => sync("contract"))); assert.equal(response.status, 500); assert.match((await response.json()).error, /DATA_REPOSITORY_NOT_CONFIGURED/);
      }
      await assert.rejects(runWithDataRepositories({ coachSheetSync: f.scope.coachSheetSync }, () => sync("contract")), /DATA_REPOSITORY_NOT_CONFIGURED/);
      assert.equal(await f.store.collection("CoachEngagement").countDocuments(), 0); assert.equal(externalReads, 0);
      const bearer = await f.call(source(),"contract",false,null,process.env.SYNC_API_SECRET); assert.equal(bearer.status,200);
      const bearerLog = await f.store.one("CoachSyncLog",{ status:"completed" }); assert.equal(bearerLog?.triggeredBy,"sync-api-secret");
      const bearerRequest = await f.store.one("ActivityRequest",{ _id:bearer.headers.get("X-Request-Id")! }); assert.equal(bearerRequest?.actorType,"token_request");
    });

    await suite.test("contract supplements only blank profile values and merges overlapping manual engagement without erasing review", async () => {
      const f = await fixture();
      await f.seed("CoachPrivateProfile", { coachId: f.id, employeeId: "MANUAL123", email: "manual-private@example.invalid", phone: null, affiliation: "Synthetic manual affiliation" });
      const existing = await f.seed("CoachEngagement", { coachId: f.id, sourceEngagementId: "hub:manual", courseName, status: "SCHEDULED", source: "MANUAL", startDate: new Date(firstDay), endDate: new Date(secondDay), rating: 5, feedback: "Synthetic manual feedback", rehire: true, hiredById: "Synthetic manual hire", reviewFlaggedAt: new Date("2099-01-01") });
      await f.seed("CoachEngagementSchedule", { engagementId: existing.id, coachId: f.id, date: new Date("2099-12-01"), startTime: "08:00", endTime: "10:00" });
      await runWithDataRepositories(f.scope, () => actors.run(managerA, () => reserve(f.id)));
      const response = await f.call(source([contractRow()])); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.result.updated, 1); assert.equal(body.result.created, 0);
      const row = await f.store.one("CoachEngagement", { _id: existing.id as string }); assert.ok(row); assert.equal(row.source, "SHEET"); assert.equal(row.rating, 5); assert.equal(row.feedback, "Synthetic manual feedback"); assert.equal(row.rehire, true); assert.equal(row.hiredById, "Synthetic manual hire"); assert.deepEqual(row.reviewFlaggedAt, new Date("2099-01-01"));
      const profile = await f.store.one("CoachPrivateProfile", { _id: f.id }); assert.equal(profile?.employeeId, "MANUAL123"); assert.equal(profile?.email, "manual-private@example.invalid"); assert.equal(profile?.phone, privatePhone); assert.equal(profile?.affiliation, "Synthetic manual affiliation");
      assert.equal((await f.store.one("Coach", { _id: f.id }))?.managerNote, "Synthetic handwritten note");
      const slots = await f.store.scan("CoachEngagementSchedule", { engagementId: existing.id }); assert.deepEqual(slots.map(row => (row.date as Date).toISOString().slice(0,10)).sort(), [firstDay,secondDay]);
      const reservation = await f.store.one("CoachDayReservation", { coachId: f.id }); assert.ok(reservation?.cancelledAt); assert.equal(reservation.confirmedEngagementId, existing.id);
      const logs = await f.store.scan("CoachSyncLog", {}); assert.equal(logs.length, 1); assert.equal(logs[0].status, "completed"); assert.equal(logs[0].updated, 1); assert.equal(logs[0].triggeredBy, managerA.user.email);
      const repeated = await f.call(source([contractRow(),contractRow()])); assert.equal(repeated.status, 200); assert.equal(await f.store.collection("CoachEngagement").countDocuments(), 1); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(), 2);
      for (const model of ["Coach","CoachPrivateProfile","CoachEngagement","CoachSyncLog","ActivityChange","ActivityRequest"]) {
        const raw = JSON.stringify(await f.store.collection(model).find({}).toArray()); for (const secret of [...(model === "CoachEngagement" ? [] : [coachName]),privateMail,privatePhone,"Synthetic manual feedback",managerA.user.email]) assert.ok(!raw.includes(secret), `${model} exposes synthetic PII`);
      }
      const rawLog = await f.store.collection("CoachSyncLog").findOne({}); assert.ok(rawLog && isEncrypted(rawLog.triggeredBy));
    });

    await suite.test("invalid/cancelled/struck/old-new coach rows skip while an existing historic coach still imports", async () => {
      const f = await fixture(), missing = contractRow(); missing[9] = "";
      const response = await f.call(source([contractRow("",courseName),contractRow(coachName,"취소 과정"),missing,contractRow("Synthetic old new coach",courseName,"2025-01-01","2025-01-02"),contractRow(coachName,"struck course"),contractRow(coachName,"Historical course","2025-01-01","2025-01-02")], [], new Set(["5:7"])));
      assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.result.skipped, 5); assert.equal(body.result.created, 1); assert.equal(body.result.errorDetail.length, 1);
      assert.equal(await f.store.collection("Coach").countDocuments(), 2); assert.equal(await f.store.collection("CoachEngagement").countDocuments(), 1);
    });

    await suite.test("Samsung replacement deletes both course names, cascades slots, sets old confirmation null and links new active reservations", async () => {
      const f = await fixture();
      const old = await f.seed("CoachEngagement", { coachId: f.id, sourceEngagementId: "hub:old-samsung", courseName: oldSamsungName, source: "MANUAL", status: "COMPLETED", startDate: new Date(firstDay), endDate: new Date(secondDay) });
      const current = await f.seed("CoachEngagement", { coachId: f.otherId, sourceEngagementId: "hub:new-samsung", courseName: samsungName, source: "MANUAL", status: "SCHEDULED", startDate: new Date(firstDay), endDate: new Date(secondDay) });
      const keep = await f.seed("CoachEngagement", { coachId: f.otherId, sourceEngagementId: "hub:keep", courseName: "Unrelated course", source: "MANUAL", status: "SCHEDULED", startDate: new Date(firstDay), endDate: new Date(secondDay) });
      for (const engagement of [old,current,keep]) await f.seed("CoachEngagementSchedule", { engagementId: engagement.id, coachId: engagement.coachId, date: new Date(firstDay), startTime: "09:00", endTime: "18:00" });
      const history = await f.seed("CoachDayReservation", { coachId: f.id, date: new Date(firstDay), reservedByEmail: managerA.user.email, reservedByName: managerA.user.name, cancelledAt: new Date("2099-01-01"), confirmedEngagementId: old.id });
      const third = await f.seed("Coach", { name: "Synthetic Cross Reference Coach", normalizedName: "synthetic cross reference coach", sourceCoachId: "synthetic:cross-ref", status: "ACTIVE", isActive: true });
      const crossHistory = await f.seed("CoachDayReservation", { coachId: third.id, date: new Date(firstDay), reservedByEmail: managerB.user.email, reservedByName: managerB.user.name, cancelledAt: new Date("2099-01-01"), confirmedEngagementId: old.id });
      await runWithDataRepositories(f.scope, () => actors.run(managerA, () => reserve(f.id)));
      const response = await f.call(source([], [samsungRow(coachName,firstDay,"2099-12-12")]), "samsung"); assert.equal(response.status, 200);
      assert.equal(await f.store.collection("CoachEngagement").countDocuments({ _id: { $in: [old.id as string,current.id as string] } }), 0);
      assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments({ engagementId: { $in: [old.id as string,current.id as string] } }), 0);
      assert.ok(await f.store.one("CoachEngagement", { _id: keep.id as string }));
      const recreated = (await f.store.scan("CoachEngagement", { courseName: samsungName }))[0]; assert.ok(recreated); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments({ engagementId: recreated.id }), 3);
      assert.equal((await f.store.one("CoachDayReservation", { _id: history.id as string }))?.confirmedEngagementId, null);
      const crossAfter = await f.store.one("CoachDayReservation", { _id: crossHistory.id as string }); assert.equal(crossAfter?.confirmedEngagementId, null); assert.deepEqual(crossAfter?.cancelledAt, new Date("2099-01-01"));
      const reservations = await f.store.scan("CoachDayReservation", { coachId: f.id }); assert.equal(reservations.length, 2); const linked = reservations.find(row => row.id !== history.id)!; assert.ok(linked.cancelledAt); assert.equal(linked.confirmedEngagementId, recreated.id);
      const changes = await f.store.scan("ActivityChange",{ targetType:"coach_day_reservations",targetId:crossHistory.id }); assert.equal(changes.length,1);
      const diff = changes[0].changes as Record<string,unknown>; assert.deepEqual(diff.confirmed_engagement_id,{ before:old.id,after:null });
      const slotChanges = await f.store.scan("ActivityChange",{ targetType:"coach_engagement_schedules",action:"create" }); assert.equal(slotChanges.length,3);
      for (const change of slotChanges) assert.deepEqual((change.changes as Record<string,unknown>).start_time,{ before:null,after:"09:00" });
    });

    await suite.test("contract late business failure rolls back the failing engagement but retains earlier phase and earlier successful rows", async () => {
      const f = await fixture();
      await f.store.db.command({ collMod: f.store.collection("CoachEngagementSchedule").collectionName, validator: { $and: [operationMongoValidator("CoachEngagementSchedule"), { date: { $ne: new Date("2099-12-20") } }] } });
      const response = await f.call(source([contractRow(coachName,"First successful course",firstDay,firstDay),contractRow("Synthetic newly created later coach","Later failing course","2099-12-19","2099-12-20")])); assert.equal(response.status, 500);
      assert.equal(await f.store.collection("Coach").countDocuments(), 3); assert.equal(await f.store.collection("CoachPrivateProfile").countDocuments(), 2);
      assert.equal(await f.store.collection("CoachEngagement").countDocuments(), 1); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(), 1);
      const changeRows = await f.store.scan("ActivityChange", { targetType: "coach_engagements" }); assert.equal(changeRows.length, 1);
      const logs = await f.store.scan("CoachSyncLog", {}); assert.equal(logs[0].status, "failed"); assert.equal(logs[0].errors, 1); assert.ok(logs[0].finishedAt instanceof Date);
      assert.ok(!JSON.stringify(await response.clone().text()).includes("Synthetic newly created later coach"));
    });

    await suite.test("Samsung late reservation audit failure restores deleted engagement graph and SetNull references", async () => {
      const f = await fixture(); const old = await f.seed("CoachEngagement", { coachId: f.id, sourceEngagementId: "hub:rollback-samsung", courseName: oldSamsungName, source: "SHEET", status: "SCHEDULED", startDate: new Date(firstDay), endDate: new Date(secondDay) });
      await f.seed("CoachEngagementSchedule", { engagementId: old.id, coachId: f.id, date: new Date(firstDay), startTime: "09:00", endTime: "18:00" });
      await f.seed("CoachDayReservation", { coachId: f.id, date: new Date(firstDay), reservedByEmail: managerA.user.email, reservedByName: managerA.user.name, cancelledAt: new Date("2099-01-01"), confirmedEngagementId: old.id });
      await runWithDataRepositories(f.scope, () => actors.run(managerA, () => reserve(f.id)));
      const active = await f.store.one("CoachDayReservation", { coachId: f.id, cancelledAt: null }); assert.ok(active);
      const graphModels = ["CoachEngagement","CoachEngagementSchedule","CoachDayReservation"], before = await snapshot(f.store, graphModels);
      await f.store.db.command({ collMod: f.store.collection("ActivityChange").collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { $nor: [{ targetType: "coach_day_reservations", action: "update", targetId: active.id }] }] } });
      const response = await f.call(source([], [samsungRow()]), "samsung"); assert.equal(response.status, 500); assert.deepEqual(await snapshot(f.store, graphModels), before);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ targetType: "coach_engagements", action: "delete" }), 0);
      assert.equal((await f.store.scan("CoachSyncLog", {}))[0].status, "failed");
    });

    await suite.test("new coach profile audit failure rolls back the entire identity transaction", async () => {
      const f = await fixture(); const before = await snapshot(f.store);
      await f.store.db.command({ collMod: f.store.collection("ActivityChange").collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetType: { $ne: "coach_private_profiles" } }] } });
      const response = await f.call(source([contractRow("Synthetic rejected new coach")])); assert.equal(response.status,500);
      assert.deepEqual(await snapshot(f.store),before); assert.equal((await f.store.scan("CoachSyncLog",{}))[0].status,"failed");
    });

    await suite.test("direct transaction needs activity context and missing catalog guard prevents opening", async () => {
      const f = await fixture();
      await assert.rejects(f.scope.coachSheetSync.transaction(async () => {}), /ACTIVITY_CONTEXT_REQUIRED/);
      await f.store.db.collection(`${f.options.namespace}_CoachCatalogGuard`).drop();
      await assert.rejects(MongoCoachSheetSyncRepository.open(f.options), /COACH_CATALOG_GUARD_NOT_READY/);
      await assert.rejects(MongoCoachSheetSyncRepository.open({ ...f.options, allowShadowWrites: false as never }), /SHADOW_WRITE_GATE/);
    });

    await suite.test("sync-log start failure prevents source reads; finish failure preserves committed business changes", async () => {
      const f = await fixture(); let sourceReads = 0;
      const input = { ...source(), readContract: async () => { sourceReads++; return { values:[["header"],contractRow()],struckCells:new Set<string>() }; } };
      const logs = f.store.collection("CoachSyncLog");
      await f.store.db.command({ collMod:logs.collectionName,validator:{ $and:[operationMongoValidator("CoachSyncLog"),{ status:{ $ne:"running" } }] } });
      assert.equal((await f.call(input)).status,500); assert.equal(sourceReads,0); assert.equal(await f.store.collection("CoachEngagement").countDocuments(),0); assert.equal(await logs.countDocuments(),0);
      await f.store.db.command({ collMod:logs.collectionName,validator:{ $and:[operationMongoValidator("CoachSyncLog"),{ status:"running" }] } });
      const response = await f.call(input); assert.equal(response.status,500); assert.equal(sourceReads,1);
      assert.equal(await f.store.collection("CoachEngagement").countDocuments(),1); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(),2);
      assert.equal(await logs.countDocuments({ status:"running" }),1); assert.match((await response.json()).error,/COACH_SYNC_LOG_FINISH_FAILED/);
    });

    for (const manualFirst of [true,false]) await suite.test(`manual private-profile edit and sheet supplementation collide with manualFirst=${manualFirst}`, async () => {
      const f = await fixture(); await prepareMongoCoachManagementStore(f.options);
      const management = await MongoCoachManagementRepository.open(f.options);
      const manual = () => runWithDataRepositories({ ...f.scope,coachManagement:management }, () => managementRoute.PUT(request(`/api/coaches/${f.id}`,"PUT",{ email:"manual-race@example.invalid",managerNote:"Synthetic concurrent manual note" }),context(f.id)));
      const sheet = (actor:Session) => f.call(source([contractRow()]),"contract",false,actor);
      const responses = await forceCatalogOrder(f,manualFirst ? manual : () => sheet(managerA),manualFirst ? () => sheet(managerB) : manual); assert.deepEqual(responses.map(row => row.status),[200,200]);
      const profile = await f.store.one("CoachPrivateProfile",{ _id:f.id }); assert.equal(profile?.email,"manual-race@example.invalid"); assert.equal(profile?.phone,privatePhone);
      assert.equal((await f.store.one("Coach",{ _id:f.id }))?.managerNote,"Synthetic concurrent manual note"); assert.equal(await f.store.collection("CoachEngagement").countDocuments(),1);
    });

    await suite.test("manual course-name update phantom is observed by a conflicting Samsung replacement", async () => {
      const f = await fixture();
      const { engagement } = await runWithDataRepositories(f.scope,() => actors.run(managerA,async () => (await manualCreate(f.otherId,"Unrelated before rename")).json()));
      const responses = await forceCatalogOrder(f,() => runWithDataRepositories(f.scope,() => engagementItemRoute.PUT(request(`/api/engagements/${engagement.id}`,"PUT",{ courseName:samsungName }),context(engagement.id))),() => f.call(source(),"samsung",false,managerB));
      assert.deepEqual(responses.map(row => row.status),[200,200]); assert.equal(await f.store.collection("CoachEngagement").countDocuments(),0); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(),0);
    });

    await suite.test("concurrent new coach and source identity sync retries catalog collision without duplicates", async () => {
      const f = await fixture(), input = source([contractRow("Synthetic concurrent new coach")]);
      const responses = await forceCatalogOrder(f, () => f.call(input,"contract",false,managerA), () => f.call(input,"contract",false,managerB)); assert.deepEqual(responses.map(row => row.status), [200,200]);
      assert.equal(await f.store.collection("Coach").countDocuments(), 3); assert.equal(await f.store.collection("CoachPrivateProfile").countDocuments(), 1); assert.equal(await f.store.collection("CoachEngagement").countDocuments(), 1); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(), 2);
      assert.equal(await f.store.collection("CoachSyncLog").countDocuments({ status: "completed" }), 2);
    });

    for (const manualFirst of [true,false]) await suite.test(`Samsung empty replacement and manual phantom insert serialize with manualFirst=${manualFirst}`, async () => {
      const f = await fixture();
      const manual = () => runWithDataRepositories(f.scope, () => manualCreate(f.otherId,samsungName));
      const sheet = (actor: Session) => f.call(source(),"samsung",false,actor);
      const responses = await forceCatalogOrder(f, manualFirst ? manual : () => sheet(managerA), manualFirst ? () => sheet(managerB) : manual);
      assert.deepEqual(responses.map(row => row.status), manualFirst ? [201,200] : [200,201]);
      assert.equal(await f.store.collection("CoachEngagement").countDocuments({ courseName: samsungName }), manualFirst ? 0 : 1);
      assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(), manualFirst ? 0 : 2);
    });

    for (const manualKind of ["reservation","month","review"] as const) await suite.test(`sheet engagement phase and manual ${manualKind} share the guard and preserve serial semantics`, async () => {
      const f = await fixture();
      const { engagement } = await runWithDataRepositories(f.scope, () => actors.run(managerA, async () => (await manualCreate(f.id)).json()));
      const manual = () => runWithDataRepositories(f.scope, () => {
        if (manualKind === "reservation") return reserve(f.id);
        if (manualKind === "month") return monthRoute.PUT(request("/api/coach/schedule/2099-12?token=synthetic-sheet-token","PUT",{ schedules: [{ date:firstDay,startTime:"07:00",endTime:"08:00" }] }), { params: Promise.resolve({ yearMonth:"2099-12" }) });
        return reviewRoute.PATCH(request(`/api/engagements/${engagement.id}/review`,"PATCH",{ rating:4,feedback:"Synthetic concurrent review" }), context(engagement.id));
      });
      const responses = await forceCatalogOrder(f, () => f.call(source([contractRow()]),"contract",false,managerA), manual, 2, "CoachSchedulingGuard"); assert.deepEqual(responses.map(row => row.status), [200,200]);
      assert.equal(await f.store.collection("CoachEngagement").countDocuments(), 1); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(), 2);
      if (manualKind === "reservation") { const reservation = await f.store.one("CoachDayReservation", { coachId:f.id }); assert.equal(reservation?.cancelledAt,null); assert.equal(reservation?.confirmedEngagementId,null); }
      if (manualKind === "month") { const schedules = await f.store.scan("CoachSchedule",{ coachId:f.id }); assert.equal(schedules.length,1); assert.equal(schedules[0].startTime,"07:00"); }
      if (manualKind === "review") { const row = await f.store.one("CoachEngagement",{ _id:engagement.id }); assert.equal(row?.rating,4); assert.equal(row?.feedback,"Synthetic concurrent review"); assert.equal(row?.source,"SHEET"); assert.equal(await f.store.collection("CoachContentEntry").countDocuments(),1); }
    });
    assert.equal(externalReads,0);
  } finally {
    try { if (connected) { assert.match(databaseName,/^hub_om_shadow_sheet_test_[a-f0-9]{24}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if(value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
