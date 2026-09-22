import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import * as readStore from "./mongoReadStore";
import { MongoOperationStore, MongoOperationError, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, mongoRuntimeContracts } from "./mongoRuntimeCodec";
import { mongoCoachFixtures } from "./mongoCoachFixtures";
const fixture = mongoCoachFixtures();
const rows = (model:string) => fixture.data.get(model) ?? [];
type Query = {where?:MongoRow;select?:MongoRow;orderBy?:MongoRow[]|MongoRow;take?:number};
function matches(row:MongoRow,where:MongoRow={}):boolean {
  return Object.entries(where).every(([key,expected])=>{
    const actual=key==="_id"?row.id??row.coachId:row[key];
    if(expected && typeof expected==="object" && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator,value])=> operator==="$in"||operator==="in"?(value as unknown[]).includes(actual):operator==="$gte"||operator==="gte"?(actual as Date)>=(value as Date):operator==="$lte"||operator==="lte"?(actual as Date)<=(value as Date):matches(actual as MongoRow,{[operator]:value}));
    }
    return actual===expected;
  });
}
function ordered(source:MongoRow[],order:Query["orderBy"]) {
  return [...source].sort((a,b)=>{for(const rule of !order?[]:Array.isArray(order)?order:[order])for(const [key,direction] of Object.entries(rule)){
    const av=a[key],bv=b[key];const cmp=av===null?(bv===null?0:1):bv===null?-1:av instanceof Date&&bv instanceof Date?av.getTime()-bv.getTime():typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv),"ko");
    if(cmp)return direction==="desc"?-cmp:cmp;
  }return 0;});
}
function coachHydrate(row:MongoRow,dashboard=false) {
  const links=(model:string,master:string)=>rows(model).filter(link=>link.coachId===row.id).map(link=>({tag:rows(master).find(tag=>tag.id===link.tagId)}));
  const engagements=rows("CoachEngagement").filter(e=>e.coachId===row.id);
  return {...row,fields:links("CoachField","CoachFieldMaster"),curriculums:links("CoachCurriculum","CoachCurriculumMaster"),
    engagements:dashboard?ordered(engagements,{endDate:"desc"}).slice(0,2):engagements,_count:{engagements:engagements.length},
    engagementSchedules:rows("CoachEngagementSchedule").filter(s=>s.coachId===row.id&&s.cancelledAt===null)};
}
const fakePrisma={
  coach:{findMany:async(q:Query)=>ordered(rows("Coach").filter(r=>matches(r,q.where)),q.orderBy).map(r=>coachHydrate(r,!!q.select?._count)),findFirst:async(q:Query)=>{const r=rows("Coach").find(r=>matches(r,q.where));return r?coachHydrate(r):null;}},
  coachEngagement:{findMany:async(q:Query)=>ordered(rows("CoachEngagement").filter(r=>matches(r,q.where)),q.orderBy)},
  coachSchedule:{findMany:async(q:Query)=>ordered(rows("CoachSchedule").map(r=>({...r,coach:rows("Coach").find(c=>c.id===r.coachId)})).filter(r=>matches(r,q.where)),q.orderBy)},
  coachEngagementSchedule:{findMany:async(q:Query)=>ordered(rows("CoachEngagementSchedule").map(r=>({...r,engagement:rows("CoachEngagement").find(e=>e.id===r.engagementId)})).filter(r=>matches(r,q.where)),q.orderBy)},
  coachDayReservation:{findMany:async(q:Query)=>rows("CoachDayReservation").filter(r=>matches(r,q.where))},
  coachPrivateProfile:{findUnique:async(q:Query)=>rows("CoachPrivateProfile").find(r=>matches(r,q.where))??null},
  coachdbArchiveRow:{findMany:async(q:Query)=>rows("CoachdbArchiveRow").map(r=>({...r,snapshot:rows("CoachdbArchiveSnapshot").find(s=>s.id===r.snapshotId)!})).filter(r=>matches(r,q.where)).sort((a,b)=>(b.snapshot.startedAt as Date).getTime()-(a.snapshot.startedAt as Date).getTime()).slice(0,q.take)}
};
mock.module("./prisma",{namedExports:{getPrismaClient:()=>fakePrisma}});
mock.module("./mongoReadStore",{namedExports:{...readStore,assertMongoReadStoreReady:async()=>{}}});
const {MongoCoachRepository}=await import("./mongoCoachRepository");
const {MongoCoachPrivateRepository}=await import("./mongoCoachPrivateRepository");
const {PrismaCoachRepository}=await import("./prismaCoachRepository");
const {PrismaCoachPrivateRepository}=await import("./prismaCoachPrivateRepository");
const options={client:{db:()=>({})} as unknown as MongoClient,databaseName:"hub_om_shadow_coach_mock",namespace:"shadow_fixture"};
test("Coach eight methods equal the existing Prisma adapter with identical mocked fixtures",async()=>{
  const saved={...process.env};
  delete process.env.SKILLFLO_COACH_URL_TEMPLATE;
  process.env.PII_ENCRYPTION_KEYS=JSON.stringify({fixture:randomBytes(32).toString("base64")});process.env.PII_ACTIVE_KEY_ID="fixture";process.env.PII_INDEX_KEY=randomBytes(32).toString("base64");
  const encoded=new Map([...fixture.data].map(([model,data])=>[model,data.map(row=>encodeMongoRuntimeDocument(model,row))]));
  // Validate actual stored keys (including blind indexes), not just logical fixture ids.
  for (const [model, documents] of encoded) {
    for (const key of mongoRuntimeContracts[model].uniqueKeys) {
      const seen = new Set<string>();
      for (const document of documents) {
        const values = key.fields.map(field => document[field === "id" ? "_id" : field]);
        if (key.nullsDistinct && values.some(value => value == null)) continue;
        const value = JSON.stringify(values);
        assert.ok(!seen.has(value), `${model} duplicate synthetic unique key: ${key.fields.join(",")}`);
        seen.add(value);
      }
    }
  }
  const decoded=(model:string)=>(encoded.get(model)??[]).map(doc=>decodeMongoRuntimeDocument(model,doc));
  const patches=[mock.method(MongoOperationStore.prototype,"scan",async(model:string,filter:MongoRow={})=>decoded(model).filter(row=>matches(row,filter))),
    mock.method(MongoOperationStore.prototype,"one",async(model:string,filter:MongoRow)=>decoded(model).find(row=>matches(row,filter))??null),
    mock.method(MongoOperationStore.prototype,"findPrivateEqual",async(model:string,field:string,value:unknown)=>decoded(model).filter(row=>row[field]===value))];
  try {
    const mongo=await MongoCoachRepository.open(options),priv=await MongoCoachPrivateRepository.open(options),pg=new PrismaCoachRepository(),pgPriv=new PrismaCoachPrivateRepository();
    const id=fixture.a.id as string,range={from:"2099-12-01",to:"2099-12-31"};
    assert.deepEqual(await mongo.listCoaches(),await pg.listCoaches());
    for(const coachId of [id,fixture.b.id as string,fixture.deleted.id as string,"missing"])assert.deepEqual(await mongo.getCoachById(coachId),await pg.getCoachById(coachId));
    assert.deepEqual(await mongo.listEngagements(id),await pg.listEngagements(id));
    assert.deepEqual(await mongo.listSchedules(id,range),await pg.listSchedules(id,range));
    assert.deepEqual(await mongo.listEngagementSchedules(id,range),await pg.listEngagementSchedules(id,range));
    for(const month of ["2099-12","2100-01","2100-02"])assert.deepEqual(await mongo.getScheduleDashboard(month),await pg.getScheduleDashboard(month));
    assert.deepEqual(await priv.getPrivateProfile(id),await pgPriv.getPrivateProfile(id));assert.equal(await priv.getPrivateProfile("missing"),null);
    assert.deepEqual(await priv.getEngagementFeedback(id),await pgPriv.getEngagementFeedback(id));
    const summary=(await mongo.listCoaches()).find(row=>row.id===id)!;assert.equal(summary.avgRating,3);assert.equal(summary.workDayCount,1);
    assert.equal((await mongo.getCoachById(id))?.statusNote,"latest");assert.equal((await mongo.getCoachById(fixture.b.id as string))?.statusNote,"");
    assert.equal((await mongo.getCoachById(id))?.coachInputUrl,null);
    process.env.SKILLFLO_COACH_URL_TEMPLATE="https://coach.example.invalid/{token}";
    assert.equal((await mongo.getCoachById(id))?.coachInputUrl,"https://coach.example.invalid/synthetic-token");
    assert.deepEqual(await mongo.getCoachById(id),await pg.getCoachById(id));
    const publicJson=JSON.stringify([await mongo.listCoaches(),await mongo.listEngagements(id),await mongo.getCoachById(id)]);
    assert.ok(!publicJson.includes("synthetic-profile@example.invalid"));assert.ok(!publicJson.includes("Synthetic private hirer"));assert.ok(!publicJson.includes('"accessToken"'));
    await assert.rejects(mongo.getScheduleDashboard("2099-13"),/INVALID_COACH_MONTH/);
    const profile=encoded.get("CoachPrivateProfile")![0];profile.email="corrupted";
    await assert.rejects(priv.getPrivateProfile(id),/COACH_READ_FAILED/);
    const field=encoded.get("CoachFieldMaster")!;encoded.set("CoachFieldMaster",[]);await assert.rejects(mongo.listCoaches(),/COACH_RELATION_MISSING/);encoded.set("CoachFieldMaster",field);
    patches[0].mock.mockImplementation(async()=>{throw new MongoOperationError("SCAN_LIMIT_EXCEEDED");});await assert.rejects(mongo.listCoaches(),/SCAN_LIMIT_EXCEEDED/);
  } finally {for(const patch of patches)patch.mock.restore();for(const name of ["PII_ENCRYPTION_KEYS","PII_ACTIVE_KEY_ID","PII_INDEX_KEY","SKILLFLO_COACH_URL_TEMPLATE"])if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
});
