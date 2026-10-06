import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { prepareMongoCalendarRuntimeStore } from "./mongoCalendarRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";

const uri=process.env.MONGODB_IMPORT_PROMOTION_COMPOSITION_TEST_URI;
const user={email:"synthetic.promotion@day1company.co.kr",name:"Synthetic Promotion"};
mock.module("@/auth",{namedExports:{auth:async()=>({user,expires:""})}});
let pgCalls=0;
mock.module("@prisma/adapter-pg",{namedExports:{PrismaPg:class{constructor(){pgCalls++;throw new Error("PG_TRIPWIRE");}}}});
mock.module("pg",{namedExports:{Pool:class{constructor(){pgCalls++;throw new Error("PG_TRIPWIRE");}}},defaultExport:{Pool:class{constructor(){pgCalls++;throw new Error("PG_TRIPWIRE");}}}});
const hooks=registerHooks({resolve(specifier,context,next){return next(["next/server","next/navigation","next/cache"].includes(specifier)?`${specifier}.js`:specifier,context);}});
const route=await import("../../app/api/admin/imports/[id]/promote/route"); hooks.deregister();
async function snapshot(store:MongoOperationStore){const value:Record<string,unknown>={};for(const item of (await store.db.listCollections({},{nameOnly:false}).toArray()).sort((a,b)=>a.name.localeCompare(b.name))){const collection=store.db.collection(item.name);value[item.name]={options:item.options,indexes:await collection.listIndexes().toArray(),rows:await collection.find({}).sort({_id:1}).toArray()};}return value;}

test("promotion route opens one prepared Mongo Calendar scope without PG fallback",{skip:!uri,timeout:180_000},async()=>{
  const target=new URL(uri!);assert.equal(target.protocol,"mongodb:");assert.equal(target.hostname,"127.0.0.1");assert.ok(target.port);assert.equal(target.username,"");assert.equal(target.password,"");
  const databaseName=`hub_om_shadow_promotion_composition_${randomBytes(6).toString("hex")}`,namespace=`shadow_promotion_composition_${randomBytes(6).toString("hex")}`;
  const env={IMPORT_PROMOTION_BACKEND:"mongodb-shadow",DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/forbidden",MONGODB_URI:uri!,MONGODB_SHADOW_DATABASE:databaseName,MONGODB_SHADOW_NAMESPACE:namespace,
    PII_ENCRYPTION_KEYS:JSON.stringify({fixture:randomBytes(32).toString("base64")}),PII_ACTIVE_KEY_ID:"fixture",PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false",
    GOOGLE_CAL_OAUTH_CLIENT_ID:"",GOOGLE_CAL_OAUTH_CLIENT_SECRET:"",GOOGLE_CAL_OAUTH_REFRESH_TOKEN:"",GOOGLE_CAL_PART_CALENDARS:""};
  const saved=new Map(Object.keys(env).map(name=>[name,process.env[name]]));Object.assign(process.env,env);
  const client=new MongoClient(uri!,{directConnection:true,serverSelectionTimeoutMS:5000});const fetchMock=mock.method(globalThis,"fetch",async()=>{throw new Error("FETCH_TRIPWIRE");});
  try{
    await client.connect();const options={client,databaseName,namespace,allowShadowWrites:true as const,processSequenceHighWater:0};await prepareMongoCalendarRuntimeStore(options);
    const store=new MongoOperationStore(options,REQUEST_AUDIT_MODELS);
    const response=await route.POST(new Request("https://example.invalid/api/admin/imports/missing/promote",{method:"POST"}),{params:Promise.resolve({id:randomUUID()})});
    assert.equal(response.status,400);assert.deepEqual(await response.json(),{ok:false,error:"반영 요청을 처리하지 못했습니다."});assert.equal(pgCalls,0);assert.equal(fetchMock.mock.callCount(),0);
    const requestId=response.headers.get("X-Request-Id");assert.ok(requestId);assert.ok(await store.one("ActivityRequest",{_id:requestId}));

    const partialNamespace=`shadow_promotion_partial_${randomBytes(6).toString("hex")}`;await client.db(databaseName).createCollection(`${partialNamespace}_LegacyOnly`,{validator:{marker:{$type:"string"}},validationLevel:"strict",validationAction:"error"});await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`).insertOne({marker:"unchanged"});
    const partial=new MongoOperationStore({...options,namespace:partialNamespace}),before=await snapshot(partial);process.env.MONGODB_SHADOW_NAMESPACE=partialNamespace;
    await assert.rejects(route.POST(new Request("https://example.invalid/api/admin/imports/missing/promote",{method:"POST"}),{params:Promise.resolve({id:randomUUID()})}),/IMPORT_PROMOTION_COMPOSITION_FAILED/);
    assert.deepEqual(await snapshot(partial),before);assert.equal(pgCalls,0);assert.equal(fetchMock.mock.callCount(),0);
  }finally{try{await client.db(databaseName).dropDatabase();}catch{}await client.close();fetchMock.mock.restore();for(const[name,value]of saved){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
