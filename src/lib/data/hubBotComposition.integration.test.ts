import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { prepareMongoHubBotRuntime, MONGO_HUBBOT_RUNTIME_MODELS } from "./mongoHubBotRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const uri = process.env.MONGODB_HUBBOT_COMPOSITION_TEST_URI;
const user = { email: "synthetic.hubbot.composition@day1company.co.kr", name: "Synthetic HubBot User" };
let actor: { user: typeof user; expires: string } | null = { user, expires: "" };
let pgCalls = 0, responderCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("@/lib/hubBot/claudeClient", { namedExports: { askHubBot: async (question: string, history: unknown[]) => { responderCalls++; assert.equal(question,"합성 질문"); assert.deepEqual(history,[{role:"user",content:"이전 질문"}]); return "합성 답변"; } } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });
const hooks=registerHooks({resolve(specifier,context,next){return next(["next/server","next/navigation"].includes(specifier)?`${specifier}.js`:specifier,context);}});
const route=await import("../../app/api/hubbot/message/route"); hooks.deregister();

async function snapshot(client: MongoClient,databaseName:string){const value:Record<string,unknown>={};for(const item of(await client.db(databaseName).listCollections({},{nameOnly:false}).toArray()).sort((a,b)=>a.name.localeCompare(b.name))){const collection=client.db(databaseName).collection(item.name);value[item.name]={options:item.options,indexes:await collection.listIndexes().toArray(),rows:await collection.find({}).sort({_id:1}).toArray()};}return value;}

test("Hubbot route uses prepared Mongo composition",{skip:!uri,timeout:120_000},async()=>{
  const target=new URL(uri!);assert.equal(target.hostname,"127.0.0.1");assert.ok(target.port);
  const databaseName=`hub_om_shadow_hubbot_composition_${randomBytes(6).toString("hex")}`,namespace=`shadow_hubbot_${randomBytes(6).toString("hex")}`;
  const environment={HUBBOT_BACKEND:"mongodb-shadow",MONGODB_URI:uri!,MONGODB_SHADOW_DATABASE:databaseName,MONGODB_SHADOW_NAMESPACE:namespace,PII_ENCRYPTION_KEYS:JSON.stringify({fixture:randomBytes(32).toString("base64")}),PII_ACTIVE_KEY_ID:"fixture",PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false",DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/forbidden",DEV_AUTH_BYPASS:"false"};
  const saved=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));Object.assign(process.env,environment);const client=new MongoClient(uri!,{directConnection:true});
  try{
    await client.connect();await prepareMongoHubBotRuntime({client,databaseName,namespace,allowShadowWrites:true,hubBotResponder:{async reply(){return"prepare-only";}}});
    const response=await route.POST(new Request("https://synthetic.invalid/api/hubbot/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:" 합성 질문 ",history:[{role:"user",content:"이전 질문"},{role:"system",content:"제외"}]})}));
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,reply:"합성 답변"});assert.equal(responderCalls,1);assert.equal(pgCalls,0);
    const requestId=response.headers.get("X-Request-Id");assert.ok(requestId);const store=new MongoOperationStore({client,databaseName,namespace},MONGO_HUBBOT_RUNTIME_MODELS);assert.ok(await store.one("ActivityRequest",{_id:requestId}));
    actor=null;await assert.rejects(route.POST(new Request("https://synthetic.invalid/api/hubbot/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"합성 질문"})})),error=>typeof(error as {digest?:unknown}).digest==="string"&&String((error as {digest:string}).digest).includes("/sign-in"));actor={user,expires:""};
    const partial=`shadow_hubbot_partial_${randomBytes(6).toString("hex")}`;process.env.MONGODB_SHADOW_NAMESPACE=partial;const legacy=client.db(databaseName).collection(`${partial}_LegacyOnly`);await client.db(databaseName).createCollection(legacy.collectionName,{validator:{marker:{$type:"string"}},validationLevel:"strict",validationAction:"error"});await legacy.insertOne({marker:"unchanged"});const before=await snapshot(client,databaseName);await assert.rejects(route.POST(new Request("https://synthetic.invalid/api/hubbot/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"합성 질문"})})),/^Error: HUBBOT_COMPOSITION_FAILED$/);assert.deepEqual(await snapshot(client,databaseName),before);assert.equal(pgCalls,0);
  }finally{actor={user,expires:""};try{await client.db(databaseName).dropDatabase();}catch{}await client.close();for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
