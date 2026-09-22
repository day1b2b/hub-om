import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { Collection, MongoClient, MongoServerError } from "mongodb";
import { activityContext } from "../activity/context";
import type { JsonObject } from "../coaches/notionCoachMap";
import { normalizeCoachName } from "../coaches/accessToken";
import type { CoachNotionSource } from "./coachNotionSyncRepository";
import type { CoachSheetSource } from "./coachSheetSyncRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoCoachNotionSyncRepository, prepareMongoCoachNotionSyncStore, COACH_NOTION_SYNC_MODELS } from "./mongoCoachNotionSyncRepository";
import { MongoCoachTokenRepository, prepareMongoCoachTokenStore } from "./mongoCoachTokenRepository";
import { MongoCoachSheetSyncRepository, prepareMongoCoachSheetSyncStore, COACH_SHEET_SYNC_MODELS } from "./mongoCoachSheetSyncRepository";
import { MongoCoachSyncLogRepository, prepareMongoCoachSyncLogStore } from "./mongoCoachSyncLogRepository";
import { MongoCoachManagementRepository, prepareMongoCoachManagementStore, COACH_MANAGEMENT_MODELS } from "./mongoCoachManagementRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { isEncrypted } from "../privacy/crypto";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const adminA: Session = { user: { email: "notion-a@day1company.co.kr", name: "Synthetic Notion Admin A" }, expires: "" };
const adminB: Session = { user: { email: "notion-b@day1company.co.kr", name: "Synthetic Notion Admin B" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("Unexpected PostgreSQL access"); } } });
let googleReads = 0;
mock.module("../coaches/googleServiceAccount", { namedExports: {
  readGoogleSpreadsheetRows: async () => { googleReads++; throw new Error("External Google source forbidden"); },
  readGoogleSheetValues: async () => { googleReads++; throw new Error("External Google source forbidden"); }
} });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const tokenRoute = await import("../../app/api/coach/me/route");
const notionRoute = await import("../../app/api/admin/sync-notion/route");
const allRoute = await import("../../app/api/sync/all/route");
const sheetRoute = await import("../../app/api/sync/engagements/route");
const managementRoute = await import("../../app/api/coaches/[id]/route");
hook.deregister();

const uri = process.env.MONGODB_COACH_NOTION_SYNC_TEST_URI;
const rich = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
const tags = (names: string[]) => ({ type: "multi_select", multi_select: names.map(name => ({ name })) });
function page(name: string, notionNo: number | null, properties: JsonObject = {}): JsonObject {
  return { id: `synthetic-page-${notionNo ?? "unkeyed"}`, properties: { "이름": { type: "title", title: [{ plain_text: name }] }, ...(notionNo === null ? {} : { ID: { type: "unique_id", unique_id: { prefix: "SYN", number: notionNo } } }), ...properties } };
}
const source = (pages: JsonObject[]): CoachNotionSource => ({ readPages: async () => pages });
const emptySheet: CoachSheetSource = { readContract: async () => ({ values: [["header"]], struckCells: new Set() }), readSamsung: async () => ({ rows: [["header"]], contractRows: [] }) };
function sheetSource(name: string): CoachSheetSource {
  const row = Array<string>(17).fill(""); row[4] = name; row[7] = "Synthetic All Sync Course"; row[9] = "2099-12-10"; row[10] = "2099-12-11"; row[12] = "09:00~18:00"; row[13] = "sheet-private@example.invalid";
  return { ...emptySheet, readContract: async () => ({ values: [["header"], row], struckCells: new Set() }) };
}
function request(path: string, method = "POST", body?: unknown, secret?: string) { return new Request(`https://example.invalid${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
const invoke = (all = false, dry = false, secret?: string) => (all ? allRoute : notionRoute)[dry ? "GET" : "POST"](request(all ? "/api/sync/all" : "/api/admin/sync-notion",dry ? "GET" : "POST",undefined,secret));

/** Requires an explicit loopback replica set and generated DB; no env-file loading or external sources. */
test("actual Notion and all-sync handlers use native Mongo with synthetic sources", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol,"mongodb:"); assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username,""); assert.equal(url.password,""); assert.ok(url.pathname === "" || url.pathname === "/");
  const databaseName = `hub_om_shadow_notion_test_${randomBytes(12).toString("hex")}`, client = new MongoClient(uri!,{ serverSelectionTimeoutMS:5000 });
  const envNames = ["PII_ENCRYPTION_KEYS","PII_ACTIVE_KEY_ID","PII_INDEX_KEY","PII_ALLOW_PLAINTEXT_READS","DATABASE_URL","DEV_AUTH_BYPASS","SYNC_API_SECRET","ADMIN_EMAILS"];
  const saved = new Map(envNames.map(name => [name,process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "notion_fixture"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ notion_fixture:randomBytes(32).toString("base64") }); process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  process.env.ADMIN_EMAILS = `${adminA.user.email},${adminB.user.email}`; process.env.SYNC_API_SECRET = `synthetic-${randomBytes(16).toString("hex")}`; delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  let connected = false, fetchCalls = 0;
  const fetchPatch = mock.method(globalThis,"fetch",async () => { fetchCalls++; throw new Error("External fetch forbidden in native Notion test"); });
  async function fixture() {
    const options = { client,databaseName,namespace:`shadow_notion_${randomBytes(8).toString("hex")}`,allowShadowWrites:true as const };
    await prepareMongoCoachNotionSyncStore(options); await prepareMongoCoachSheetSyncStore(options); await prepareMongoCoachSyncLogStore(options); await prepareMongoCoachManagementStore(options); await prepareMongoRequestAuditStore(options);
    const scope = { coachNotionSync:await MongoCoachNotionSyncRepository.open(options),coachNotionSource:source([]),coachSheetSync:await MongoCoachSheetSyncRepository.open(options),coachSheetSource:emptySheet,coachSyncLog:await MongoCoachSyncLogRepository.open(options),coachManagement:await MongoCoachManagementRepository.open(options),requestActivity:await MongoRequestAuditRepository.open(options) };
    const store = new MongoOperationStore(options,[...new Set([...COACH_NOTION_SYNC_MODELS,...COACH_SHEET_SYNC_MODELS,...COACH_MANAGEMENT_MODELS,...REQUEST_AUDIT_MODELS,"CoachSyncLog"])]);
    const seed = async (model:string,values:MongoRow) => { const row = coachFixtureRow(model,values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model,row)); return row; };
    const coach = (name:string,values:MongoRow = {}) => seed("Coach",{ name,normalizedName:normalizeCoachName(name),status:"ACTIVE",isActive:true,...values });
    const call = (pages:JsonObject[],all = false,dry = false,actor:Session|null = adminA,sheet:CoachSheetSource = emptySheet,secret?:string) => runWithDataRepositories({ ...scope,coachNotionSource:source(pages),coachSheetSource:sheet },() => actors.run(actor,() => invoke(all,dry,secret)));
    return { options,scope,store,seed,coach,call };
  }
  const businessModels = ["Coach","CoachPrivateProfile","CoachField","CoachFieldMaster","CoachCurriculum","CoachCurriculumMaster","CoachContentEntry","CoachEngagement","CoachEngagementSchedule","ActivityChange"];
  const snapshot = (store:MongoOperationStore) => Promise.all(businessModels.map(model => store.collection(model).find({}).sort({ _id:1 }).toArray()));
  async function forceOrder(f:Awaited<ReturnType<typeof fixture>>,first:() => Promise<Response>,second:() => Promise<Response>) {
    const deferred = () => { let resolve!:() => void; const promise = new Promise<void>(done => { resolve=done; }); return { promise,resolve }; };
    const held=deferred(),conflict=deferred(),release=deferred(); let holding=false,attempts=0,collisions=0;
    const original=Collection.prototype.updateOne,guard=`${f.options.namespace}_CoachCatalogGuard`;
    const patch=mock.method(Collection.prototype,"updateOne",async function(this:Collection,...args:Parameters<Collection["updateOne"]>) {
      const relevant=this.collectionName===guard,actor=activityContext.getStore()?.actorEmail;
      if(relevant&&actor===adminB.user.email) attempts++;
      try { const result=await original.apply(this,args); if(relevant&&actor===adminA.user.email&&!holding) { holding=true; held.resolve(); await release.promise; } return result; }
      catch(error) { if(relevant&&actor===adminB.user.email&&error instanceof MongoServerError&&[112,11000].includes(Number(error.code))) { collisions++; conflict.resolve(); } throw error; }
    });
    const pending:Promise<Response>[]=[];
    const deadline=async (value:Promise<unknown>) => { let timer:ReturnType<typeof setTimeout>|undefined; try { await Promise.race([value,new Promise<never>((_,reject) => { timer=setTimeout(() => reject(new Error("Notion catalog barrier deadline")),8000); })]); } finally { clearTimeout(timer); } };
    try {
      const a=actors.run(adminA,first); pending.push(a); void a.catch(() => {}); await deadline(Promise.race([held.promise,a.then(() => { throw new Error("First writer bypassed catalog guard"); })]));
      const b=actors.run(adminB,second); pending.push(b); void b.catch(() => {}); await deadline(Promise.race([conflict.promise,b.then(() => { throw new Error("Second writer did not conflict"); })]));
      release.resolve(); const responses=await Promise.all(pending); assert.ok(collisions>=1); assert.ok(attempts>=2); return responses;
    } finally { release.resolve(); held.resolve(); conflict.resolve(); await Promise.allSettled(pending); patch.mock.restore(); }
  }
  try {
    await client.connect(); connected=true;
    await suite.test("real admin and bearer access, missing scoped dependencies and external fences",async () => {
      const f=await fixture();
      for(const all of [false,true]) {
        for(const actor of [null,{ user:{ email:"ordinary@day1company.co.kr",name:"Ordinary" },expires:"" }]) assert.equal((await f.call([page("Synthetic denied",9101)],all,false,actor)).status,500);
        assert.equal((await f.call([],all,true,null,emptySheet,"wrong-secret")).status,500);
        assert.equal((await f.call([],all,true,null,emptySheet,process.env.SYNC_API_SECRET)).status,200);
        for(const missing of ["coachNotionSync","coachNotionSource","coachSyncLog"] as const) {
          const scope={ ...f.scope }; delete (scope as Partial<typeof scope>)[missing];
          const response=await runWithDataRepositories(scope,() => actors.run(adminA,() => invoke(all))); assert.equal(response.status,500);
        }
      }
      await assert.rejects(runWithDataRepositories({ coachNotionSync:f.scope.coachNotionSync },() => invoke()),/DATA_REPOSITORY_NOT_CONFIGURED/);
      assert.equal(await f.store.collection("Coach").countDocuments(),0); assert.equal(fetchCalls,0); assert.equal(googleReads,0);
    });

    await suite.test("all-sync preflight rejects missing sheet ports before Notion source, business or run-log effects",async () => {
      const f=await fixture(); let notionReads=0;
      for(const missing of ["coachSheetSync","coachSheetSource"] as const) for(const dry of [true,false]) {
        const scope={ ...f.scope,coachNotionSource:{ readPages:async () => { notionReads++; return [page("Synthetic preflight person",9108)]; } } };
        delete (scope as Partial<typeof scope>)[missing];
        const response=await runWithDataRepositories(scope,() => actors.run(adminA,() => invoke(true,dry))); assert.equal(response.status,500);
        assert.match((await response.json()).error,/DATA_REPOSITORY_NOT_CONFIGURED/);
      }
      assert.equal(notionReads,0); assert.equal(await f.store.collection("CoachSyncLog").countDocuments(),0);
      for(const model of businessModels) assert.equal(await f.store.collection(model).countDocuments(),0);
      for(const name of ["CoachCatalogGuard","CoachSchedulingGuard"]) assert.equal(await f.store.db.collection(`${f.options.namespace}_${name}`).countDocuments(),0);
      assert.equal(fetchCalls,0); assert.equal(googleReads,0);
    });

    await suite.test("synthetic source and driver errors stay sanitized across actual handlers and run logs",async () => {
      const f=await fixture(),marker="SYNTHETIC_NOTION_PRIVATE_ERROR_529a";
      for(const dry of [true,false]) {
        const response=await runWithDataRepositories({ ...f.scope,coachNotionSource:{ readPages:async () => { throw new Error(marker); } } },() => actors.run(adminA,() => invoke(false,dry)));
        assert.equal(response.status,500); const body=await response.json(); assert.equal(body.error,"COACH_NOTION_SOURCE_FAILED"); assert.ok(!JSON.stringify(body).includes(marker));
      }
      const original=Collection.prototype.find;
      const patch=mock.method(Collection.prototype,"find",function(this:Collection,...args:Parameters<Collection["find"]>) { if(this.collectionName===f.store.collection("Coach").collectionName) throw new Error(marker); return original.apply(this,args); });
      try {
        for(const dry of [true,false]) {
          const response=await f.call([page("Synthetic private driver case",9109)],false,dry); assert.equal(response.status,200);
          const { result }=await response.json(); assert.equal(result.errors,1); assert.deepEqual(result.errorDetail,["COACH_NOTION_ROW_FAILED"]);
        }
      } finally { patch.mock.restore(); }
      assert.equal(await f.store.collection("Coach").countDocuments(),0);
      const logs=await f.store.scan("CoachSyncLog",{}); assert.equal(logs.length,2); assert.ok(logs.every(row => !String(row.errorDetail).includes(marker)));
    });

    await suite.test("dry-run reports identity and name differences but writes no business, guard or run-log rows",async () => {
      const f=await fixture(); const existing=await f.coach("Synthetic stable website name",{ notionNo:9110,deletedAt:new Date("2099-01-01") });
      const before=await snapshot(f.store),guards=async () => Promise.all(["CoachCatalogGuard","CoachSchedulingGuard"].map(name => f.store.db.collection(`${f.options.namespace}_${name}`).find({}).toArray())),beforeGuards=await guards();
      const response=await f.call([page("Synthetic renamed in source",9110),page("Synthetic preview new",9111),{}],false,true); assert.equal(response.status,200);
      const { result }=await response.json(); assert.equal(result.updated,1); assert.equal(result.created,1); assert.equal(result.skipped,1); assert.ok(result.changes[0].details.includes("사이트 이름은 유지"));
      assert.deepEqual(await snapshot(f.store),before); assert.deepEqual(await guards(),beforeGuards); assert.equal(await f.store.collection("CoachSyncLog").countDocuments(),0); assert.ok(await f.store.one("Coach",{ _id:existing.id as string }));
    });

    await suite.test("notion ID wins over names, includes deleted coaches, keeps website names and existing profile employee IDs",async () => {
      const f=await fixture(); const existing=await f.coach("Synthetic retained website name",{ notionNo:9120,employeeNo:"700001",accessToken:"synthetic-notion-deleted-token",deletedAt:new Date("2099-01-01"),status:"INACTIVE",isActive:false });
      await f.seed("CoachPrivateProfile",{ coachId:existing.id,employeeId:"MANUAL-EMPLOYEE",phone:"010-0000-0001",email:"old-private@example.invalid" });
      const response=await f.call([page("Synthetic source rename",9120,{ "사번":{ type:"number",number:700002 },"연락처":rich("010-0000-0002"),"이메일":rich("new-private@example.invalid"),"교육 및 가능 분야":tags(["Synthetic Field A"]),"가능 커리큘럼":tags(["Synthetic Curriculum A"]) })]); assert.equal(response.status,200);
      const responseText=await response.text(); assert.ok(!responseText.includes("synthetic-notion-deleted-token")); const { result }=JSON.parse(responseText); assert.equal(result.updated,1); assert.equal(result.created,0);
      await prepareMongoCoachTokenStore(f.options); const token=await MongoCoachTokenRepository.open(f.options);
      const denied=await runWithDataRepositories({ ...f.scope,coachToken:token },() => tokenRoute.GET(request("/api/coach/me?token=synthetic-notion-deleted-token","GET"))); assert.equal(denied.status,401); assert.ok(!(await denied.text()).includes("synthetic-notion-deleted-token"));
      const row=await f.store.one("Coach",{ _id:existing.id as string }); assert.equal(row?.name,"Synthetic retained website name"); assert.equal(row?.employeeNo,"700002"); assert.deepEqual(row?.deletedAt,new Date("2099-01-01")); assert.equal(row?.status,"INACTIVE"); assert.equal(row?.isActive,false);
      const profile=await f.store.one("CoachPrivateProfile",{ _id:existing.id as string }); assert.equal(profile?.employeeId,"MANUAL-EMPLOYEE"); assert.equal(profile?.phone,"010-0000-0002"); assert.equal(profile?.email,"new-private@example.invalid");
      assert.equal(await f.store.collection("CoachField").countDocuments({ coachId:existing.id }),1); assert.equal(await f.store.collection("CoachCurriculum").countDocuments({ coachId:existing.id }),1);
      const raw=await f.store.collection("Coach").findOne({ _id:existing.id as string }); assert.ok(raw&&isEncrypted(raw.name)&&isEncrypted(raw.employeeNo));
      for(const model of ["Coach","CoachPrivateProfile","ActivityChange","CoachSyncLog","ActivityRequest"]) { const rawRows=JSON.stringify(await f.store.collection(model).find({}).toArray()); for(const pii of ["Synthetic retained website name","new-private@example.invalid","010-0000-0002","700002",adminA.user.email]) assert.ok(!rawRows.includes(pii),`${model} contains synthetic private value`); }
    });

    await suite.test("unkeyed same-name matching picks the oldest row; duplicate contacts merge empty fields and preserve original identity and tags",async () => {
      const f=await fixture(),name="Synthetic Match Person";
      const older=await f.coach(name,{ createdAt:new Date("2090-01-01"),notionNo:null }),later=await f.coach(name,{ createdAt:new Date("2091-01-01"),notionNo:null });
      await f.call([page(name,9130,{ "연락처":rich("010-1111-1111"),"근무 유형":tags(["운영조교"]),"교육 및 가능 분야":tags(["Synthetic Original Field"]) })]);
      assert.equal((await f.store.one("Coach",{ _id:older.id as string }))?.notionNo,9130); assert.equal((await f.store.one("Coach",{ _id:later.id as string }))?.notionNo,null);
      // Give the other unkeyed row its own ID so the next page reaches duplicate-contact matching.
      await f.store.collection("Coach").replaceOne({ _id:later.id as string },encodeMongoRuntimeDocument("Coach",{ ...later,notionNo:9131 }));
      const duplicate=await f.call([page(name,9132,{ "연락처":rich("010-1111-1111"),"이메일":rich("filled-duplicate@example.invalid"),"근무 유형":tags(["실습코치"]),"교육 및 가능 분야":tags(["Synthetic Incoming Field"]),"가능 커리큘럼":tags(["Synthetic New Curriculum"]) })]); assert.equal(duplicate.status,200); assert.equal((await duplicate.json()).result.updated,1);
      const kept=await f.store.one("Coach",{ _id:older.id as string }); assert.equal(kept?.notionNo,9130); assert.equal(kept?.workType,"운영조교"); assert.equal((await f.store.one("CoachPrivateProfile",{ _id:older.id as string }))?.email,"filled-duplicate@example.invalid");
      assert.equal(await f.store.collection("CoachFieldMaster").countDocuments({ name:"Synthetic Incoming Field" }),0); assert.equal(await f.store.collection("CoachCurriculum").countDocuments({ coachId:older.id }),1);
      const distinct=await f.call([page(name,9133,{ "연락처":rich("010-2222-2222") })]); assert.equal((await distinct.json()).result.created,1); assert.equal(await f.store.collection("Coach").countDocuments(),3);
    });

    await suite.test("birth-date duplicate matching and no-ID name matching retain the earliest existing identity",async () => {
      const f=await fixture(),name="Synthetic Birthday Person",old=await f.coach(name,{ notionNo:9140,createdAt:new Date("2090-01-01") });
      await f.seed("CoachPrivateProfile",{ coachId:old.id,birthDate:new Date("1990-05-06"),phone:"010-3333-3333" });
      const response=await f.call([page(name,9141,{ "생년월일":rich("1990-05-06"),"연락처":rich("010-4444-4444") }),page(name,null,{ "소속":rich("Synthetic No ID Affiliation") })]); assert.equal((await response.json()).result.updated,2);
      assert.equal(await f.store.collection("Coach").countDocuments(),1); assert.equal((await f.store.one("Coach",{ _id:old.id as string }))?.notionNo,9140); assert.equal((await f.store.one("CoachPrivateProfile",{ _id:old.id as string }))?.phone,"010-3333-3333");
    });

    await suite.test("empty incoming tags preserve links; nonempty tags replace links and reuse unique masters",async () => {
      const f=await fixture(),name="Synthetic Tag Person";
      await f.call([page(name,9150,{ "교육 및 가능 분야":tags(["Synthetic Shared Field","Synthetic Shared Field"]),"가능 커리큘럼":tags(["Synthetic Curriculum One"]) })]);
      const coach=await f.store.one("Coach",{ notionNo:9150 }); assert.ok(coach);
      await f.call([page(name,9150)]); assert.equal(await f.store.collection("CoachField").countDocuments({ coachId:coach.id }),1); assert.equal(await f.store.collection("CoachCurriculum").countDocuments({ coachId:coach.id }),1);
      await f.call([page(name,9150,{ "교육 및 가능 분야":tags(["Synthetic Replacement Field"]),"가능 커리큘럼":tags(["Synthetic Curriculum Two"]) })]);
      assert.equal(await f.store.collection("CoachField").countDocuments({ coachId:coach.id }),1); assert.equal(await f.store.collection("CoachFieldMaster").countDocuments(),2); assert.equal(await f.store.collection("CoachCurriculumMaster").countDocuments(),2);
    });

    await suite.test("late row audit failure rolls back coach, private profile, masters and links, then continues the next page",async () => {
      const f=await fixture(); const failing=await f.coach("Synthetic failing existing",{ notionNo:9160,workType:"운영조교" });
      await f.seed("CoachPrivateProfile",{ coachId:failing.id,email:"original@example.invalid" });
      const rawCoach=await f.store.collection("Coach").findOne({ _id:failing.id as string }),rawPrivate=await f.store.collection("CoachPrivateProfile").findOne({ _id:failing.id as string });
      await f.store.db.command({ collMod:f.store.collection("ActivityChange").collectionName,validator:{ $and:[operationMongoValidator("ActivityChange"),{ targetType:{ $ne:"coach_curriculums" } }] } });
      const response=await f.call([page("Synthetic failing existing",9160,{ "근무 유형":tags(["실습코치"]),"이메일":rich("changed@example.invalid"),"교육 및 가능 분야":tags(["Synthetic rolled back field"]),"가능 커리큘럼":tags(["Synthetic rolled back curriculum"]) }),page("Synthetic succeeding next",9161)]); assert.equal(response.status,200);
      const { result }=await response.json(); assert.equal(result.errors,1); assert.equal(result.created,1); assert.equal(result.updated,0);
      assert.deepEqual(await f.store.collection("Coach").findOne({ _id:failing.id as string }),rawCoach); assert.deepEqual(await f.store.collection("CoachPrivateProfile").findOne({ _id:failing.id as string }),rawPrivate);
      for(const model of ["CoachField","CoachFieldMaster","CoachCurriculum","CoachCurriculumMaster"]) assert.equal(await f.store.collection(model).countDocuments(),0);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ targetId:failing.id }),0);
      const log=(await f.store.scan("CoachSyncLog",{}))[0]; assert.equal(log.status,"completed_with_errors"); assert.equal(log.errors,1); assert.equal(log.created,1);
    });

    await suite.test("employee number unique conflict is isolated to one page and later pages still commit",async () => {
      const f=await fixture(); await f.coach("Synthetic employee owner",{ notionNo:9170,employeeNo:"800001" });
      const response=await f.call([page("Synthetic employee collision",9171,{ "사번":{ type:"number",number:800001 } }),page("Synthetic employee successor",9172,{ "사번":{ type:"number",number:800002 } })]); assert.equal(response.status,200);
      const { result }=await response.json(); assert.equal(result.errors,1); assert.equal(result.created,1); assert.equal(await f.store.collection("Coach").countDocuments(),2); assert.equal(await f.store.collection("Coach").countDocuments({ notionNo:9171 }),0);
      assert.ok(!JSON.stringify(result.errorDetail).includes("E11000")); assert.ok(!JSON.stringify(result.errorDetail).includes("800001"));
    });

    await suite.test("all-sync uses synthetic Notion, contract and schedule sources in order and records aggregate result",async () => {
      const f=await fixture(),order:string[]=[],name="Synthetic All Person",sheet=sheetSource(name);
      const scope={ ...f.scope,coachNotionSource:{ readPages:async () => { order.push("notion"); return [page(name,9180)]; } },coachSheetSource:{ readContract:async () => { order.push("contract"); return sheet.readContract(); },readSamsung:async () => { order.push("samsung"); return sheet.readSamsung(); } } };
      const response=await runWithDataRepositories(scope,() => actors.run(adminA,() => invoke(true))); assert.equal(response.status,200); const { result }=await response.json(); assert.equal(result.totalRows,2); assert.equal(result.created,2); assert.deepEqual(order,["notion","contract","samsung"]);
      assert.equal(await f.store.collection("Coach").countDocuments(),1); assert.equal(await f.store.collection("CoachEngagement").countDocuments(),1); assert.equal(await f.store.collection("CoachEngagementSchedule").countDocuments(),2);
      const log=(await f.store.scan("CoachSyncLog",{}))[0]; assert.equal(log.type,"all"); assert.equal(log.status,"completed"); assert.equal(log.created,2);
      const requestId=response.headers.get("X-Request-Id"); assert.ok(requestId); assert.equal((await f.store.one("ActivityRequest",{ _id:requestId }))?.actorEmail,adminA.user.email);
    });

    await suite.test("all-sync later source failure preserves the completed Notion phase and records a failed run",async () => {
      const f=await fixture(),marker="Synthetic external private error 9419";
      const broken:CoachSheetSource={ ...emptySheet,readContract:async () => { throw new Error(marker); } };
      const response=await f.call([page("Synthetic Notion phase committed",9190)],true,false,adminA,broken); assert.equal(response.status,500); assert.ok(!(await response.text()).includes(marker));
      assert.equal(await f.store.collection("Coach").countDocuments(),1); assert.equal(await f.store.collection("CoachPrivateProfile").countDocuments(),1); assert.equal(await f.store.collection("CoachEngagement").countDocuments(),0); assert.equal((await f.store.scan("CoachSyncLog",{}))[0].status,"failed");
    });

    await suite.test("concurrent same identity pages retry under catalog and create one coach and one master per shared tag",async () => {
      const f=await fixture(),pages=[page("Synthetic concurrent same identity",9200,{ "교육 및 가능 분야":tags(["Synthetic Concurrent Field"]),"가능 커리큘럼":tags(["Synthetic Concurrent Curriculum"]) })];
      const responses=await forceOrder(f,() => f.call(pages,false,false,adminA),() => f.call(pages,false,false,adminB)); assert.deepEqual(responses.map(row => row.status),[200,200]);
      assert.equal(await f.store.collection("Coach").countDocuments(),1); assert.equal(await f.store.collection("CoachPrivateProfile").countDocuments(),1);
      for(const model of ["CoachFieldMaster","CoachCurriculumMaster","CoachField","CoachCurriculum"]) assert.equal(await f.store.collection(model).countDocuments(),1);
      const counts=await Promise.all(responses.map(async response => (await response.json()).result)); assert.equal(counts.reduce((sum,row) => sum+row.created,0),1); assert.equal(counts.reduce((sum,row) => sum+row.updated,0),1);
    });

    await suite.test("distinct concurrent coaches reuse shared tag masters after a real catalog conflict",async () => {
      const f=await fixture(),properties={ "교육 및 가능 분야":tags(["Synthetic Shared Race Field"]),"가능 커리큘럼":tags(["Synthetic Shared Race Curriculum"]) };
      const responses=await forceOrder(f,() => f.call([page("Synthetic race one",9210,properties)],false,false,adminA),() => f.call([page("Synthetic race two",9211,properties)],false,false,adminB)); assert.deepEqual(responses.map(row => row.status),[200,200]);
      assert.equal(await f.store.collection("Coach").countDocuments(),2); assert.equal(await f.store.collection("CoachFieldMaster").countDocuments(),1); assert.equal(await f.store.collection("CoachCurriculumMaster").countDocuments(),1); assert.equal(await f.store.collection("CoachField").countDocuments(),2); assert.equal(await f.store.collection("CoachCurriculum").countDocuments(),2);
    });

    await suite.test("a real unique-master race retries the row, reuses the winner and independently enforces 11000",async () => {
      const f=await fixture(),other=await f.coach("Synthetic external tag owner"),masterName="Synthetic 11000 shared master",winnerId=randomUUID();
      const original=Collection.prototype.insertOne,codes:number[]=[]; let injected=false,coachAttempts=0;
      const patch=mock.method(Collection.prototype,"insertOne",async function(this:Collection,...args:Parameters<Collection["insertOne"]>) {
        if(this.collectionName===f.store.collection("Coach").collectionName&&args[0].notionNo===9215) coachAttempts++;
        const isTarget=this.collectionName===f.store.collection("CoachFieldMaster").collectionName&&args[0].name===masterName;
        if(isTarget&&!injected) {
          injected=true;
          // This synthetic competing writer commits outside the row's snapshot/session.
          await original.call(this,{ ...args[0],_id:winnerId as never });
          await f.store.collection("CoachField").insertOne(encodeMongoRuntimeDocument("CoachField",{ coachId:other.id,tagId:winnerId }));
        }
        try { return await original.apply(this,args); }
        catch(error) { if(isTarget&&error instanceof MongoServerError) codes.push(Number(error.code)); throw error; }
      });
      let response:Response;
      try { response=await f.call([page("Synthetic transaction retry person",9215,{ "교육 및 가능 분야":tags([masterName]) })]); }
      finally { patch.mock.restore(); }
      assert.equal(response.status,200); const { result }=await response.json(); assert.equal(result.created,1); assert.equal(result.updated,0); assert.equal(result.errors,0);
      assert.ok(codes.some(code => code===112||code===11000),`Expected real write conflict or duplicate-key race; observed codes: ${codes.join(",")}`);
      assert.ok(coachAttempts>=2,"The entire row callback must retry, including coach creation");
      suite.diagnostic(`Native master-race server codes: ${codes.join(",")}; coach callback attempts: ${coachAttempts}`);
      assert.equal(await f.store.collection("CoachFieldMaster").countDocuments(),1); assert.equal(await f.store.collection("CoachFieldMaster").countDocuments({ _id:winnerId }),1);
      assert.equal(await f.store.collection("CoachField").countDocuments({ tagId:winnerId }),2); assert.equal(await f.store.collection("Coach").countDocuments(),2);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ targetType:"coaches",action:"create" }),1);
      // Independently verify the unique index with a real nontransactional duplicate insert.
      // This is constraint evidence, not evidence of a 11000-triggered transaction retry.
      const before=await snapshot(f.store),winner=await f.store.collection("CoachFieldMaster").findOne({ _id:winnerId }); assert.ok(winner);
      await assert.rejects(f.store.collection("CoachFieldMaster").insertOne({ ...winner,_id:randomUUID() }),error => error instanceof MongoServerError&&error.code===11000);
      assert.deepEqual(await snapshot(f.store),before);
    });

    for(const manualFirst of [true,false]) await suite.test(`duplicate-row supplementation rereads a concurrent private edit with manualFirst=${manualFirst}`,async () => {
      const f=await fixture(),name="Synthetic duplicate private race",existing=await f.coach(name,{ notionNo:9216 });
      await f.seed("CoachPrivateProfile",{ coachId:existing.id,phone:"010-7777-7777",birthDate:new Date("1991-02-03"),email:null });
      const manual=() => runWithDataRepositories(f.scope,() => managementRoute.PUT(request(`/api/coaches/${existing.id}`,"PUT",{ email:"manual-duplicate-race@example.invalid" }),{ params:Promise.resolve({ id:existing.id as string }) }));
      const notion=(actor:Session) => f.call([page(name,9217,{ "연락처":rich("010-7777-7777"),"생년월일":rich("1991-02-03"),"이메일":rich("notion-duplicate-fill@example.invalid") })],false,false,actor);
      const responses=await forceOrder(f,manualFirst?manual:() => notion(adminA),manualFirst?() => notion(adminB):manual); assert.deepEqual(responses.map(row => row.status),[200,200]);
      const notionResponse=responses[manualFirst?1:0]; assert.equal((await notionResponse.json()).result.updated,1);
      assert.equal(await f.store.collection("Coach").countDocuments(),1); assert.equal((await f.store.one("Coach",{ _id:existing.id as string }))?.notionNo,9216);
      assert.equal((await f.store.one("CoachPrivateProfile",{ _id:existing.id as string }))?.email,"manual-duplicate-race@example.invalid");
    });

    for(const manualFirst of [true,false]) await suite.test(`manual rename and Notion matching read committed identity with manualFirst=${manualFirst}`,async () => {
      const f=await fixture(),name="Synthetic before rename",existing=await f.coach(name);
      const manual=() => runWithDataRepositories(f.scope,() => managementRoute.PUT(request(`/api/coaches/${existing.id}`,"PUT",{ name:"Synthetic renamed manually" }),{ params:Promise.resolve({ id:existing.id as string }) }));
      const notion=(actor:Session) => f.call([page(name,9220)],false,false,actor);
      const responses=await forceOrder(f,manualFirst?manual:() => notion(adminA),manualFirst?() => notion(adminB):manual); assert.deepEqual(responses.map(row => row.status),[200,200]);
      const original=await f.store.one("Coach",{ _id:existing.id as string }); assert.equal(original?.name,"Synthetic renamed manually"); assert.equal(original?.notionNo,manualFirst?null:9220); assert.equal(await f.store.collection("Coach").countDocuments(),manualFirst?2:1);
      const matched=await f.store.one("Coach",{ notionNo:9220 }); assert.ok(matched); assert.equal(matched.name,manualFirst?name:"Synthetic renamed manually");
    });

    for(const sheetFirst of [true,false]) await suite.test(`sheet and Notion new-name identity creation serialize with sheetFirst=${sheetFirst}`,async () => {
      const f=await fixture(),name="Synthetic cross-source identity",sheet=sheetSource(name);
      const sheetCall=() => runWithDataRepositories({ ...f.scope,coachSheetSource:sheet },() => sheetRoute.POST(request("/api/sync/engagements")));
      const notion=(actor:Session) => f.call([page(name,9230)],false,false,actor);
      const responses=await forceOrder(f,sheetFirst?sheetCall:() => notion(adminA),sheetFirst?() => notion(adminB):sheetCall); assert.deepEqual(responses.map(row => row.status),[200,200]);
      assert.equal(await f.store.collection("Coach").countDocuments(),1); const coach=await f.store.one("Coach",{ notionNo:9230 }); assert.ok(coach); assert.equal(await f.store.collection("CoachEngagement").countDocuments({ coachId:coach.id }),1);
    });

    await suite.test("direct mutation and missing catalog guard fail closed",async () => {
      const f=await fixture(); await assert.rejects(f.scope.coachNotionSync.transaction(async () => {}),/ACTIVITY_CONTEXT_REQUIRED/);
      await f.store.db.collection(`${f.options.namespace}_CoachCatalogGuard`).drop(); await assert.rejects(MongoCoachNotionSyncRepository.open(f.options),/COACH_CATALOG_GUARD_NOT_READY/);
      await assert.rejects(MongoCoachNotionSyncRepository.open({ ...f.options,allowShadowWrites:false as never }),/SHADOW_WRITE_GATE/);
    });
    assert.equal(fetchCalls,0); assert.equal(googleReads,0);
  } finally {
    try { if(connected) { assert.match(databaseName,/^hub_om_shadow_notion_test_[a-f0-9]{24}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { fetchPatch.mock.restore(); for(const name of envNames) { const value=saved.get(name); if(value===undefined) delete process.env[name]; else process.env[name]=value; } } }
  }
});
