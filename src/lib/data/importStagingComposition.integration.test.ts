import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { MONGO_IMPORT_TEMPLATE_MODELS, MONGO_IMPORT_UPLOAD_MODELS, prepareMongoImportTemplateRuntime, prepareMongoImportUploadRuntime } from "./mongoImportStagingRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const uri = process.env.MONGODB_IMPORT_STAGING_COMPOSITION_TEST_URI;
const user = { email: "synthetic.import@day1company.co.kr", name: "Synthetic Import" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "" }) } });
let pgCalls=0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor(){ pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor(){ pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor(){ pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks=registerHooks({resolve(specifier,context,next){return next(["next/server","next/navigation","next/cache"].includes(specifier)?`${specifier}.js`:specifier,context);}});
const uploadRoute=await import("../../app/api/admin/imports/upload/route"), templateRoute=await import("../../app/api/admin/imports/template/route"); hooks.deregister();
async function snapshot(store:MongoOperationStore){const value:Record<string,unknown>={};for(const item of (await store.db.listCollections({},{nameOnly:false}).toArray()).sort((a,b)=>a.name.localeCompare(b.name))){const collection=store.db.collection(item.name);value[item.name]={options:item.options,indexes:await collection.listIndexes().toArray(),rows:await collection.find({}).sort({_id:1}).toArray()};}return value;}

test("import template and upload routes use their prepared minimal Mongo scopes", {skip:!uri,timeout:180_000}, async()=>{
  const target=new URL(uri!); assert.equal(target.protocol,"mongodb:"); assert.equal(target.hostname,"127.0.0.1"); assert.ok(target.port); assert.equal(target.username,""); assert.equal(target.password,"");
  const databaseName=`hub_om_shadow_import_composition_${randomBytes(6).toString("hex")}`;
  const templateNamespace=`shadow_import_template_${randomBytes(6).toString("hex")}`, uploadNamespace=`shadow_import_upload_${randomBytes(6).toString("hex")}`;
  const env={IMPORT_STAGING_BACKEND:"mongodb-shadow",DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/forbidden",MONGODB_URI:uri!,MONGODB_SHADOW_DATABASE:databaseName,MONGODB_SHADOW_NAMESPACE:templateNamespace,
    PII_ENCRYPTION_KEYS:JSON.stringify({fixture:randomBytes(32).toString("base64")}),PII_ACTIVE_KEY_ID:"fixture",PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false"};
  const saved=new Map(Object.keys(env).map(name=>[name,process.env[name]])); Object.assign(process.env,env);
  const client=new MongoClient(uri!,{directConnection:true,monitorCommands:true,serverSelectionTimeoutMS:5000});
  const writes:CommandStartedEvent[]=[],mutations=new Set(["create","createIndexes","collMod","insert","update","delete","drop","dropDatabase","dropIndexes","findAndModify","bulkWrite","renameCollection"]); client.on("commandStarted",event=>{if(mutations.has(event.commandName))writes.push(event);});
  try{
    await client.connect();
    const templateOptions={client,databaseName,namespace:templateNamespace,allowShadowWrites:true as const}; await prepareMongoImportTemplateRuntime(templateOptions);
    const templateStore=new MongoOperationStore(templateOptions,MONGO_IMPORT_TEMPLATE_MODELS);
    const template=await templateRoute.GET(); assert.equal(template.status,200); assert.match(template.headers.get("content-type")??"",/spreadsheetml/); assert.ok((await template.arrayBuffer()).byteLength>1000);
    assert.ok(await templateStore.one("ActivityRequest",{_id:template.headers.get("X-Request-Id")!}));

    process.env.MONGODB_SHADOW_NAMESPACE=uploadNamespace;
    const uploadOptions={client,databaseName,namespace:uploadNamespace,allowShadowWrites:true as const}; await prepareMongoImportUploadRuntime(uploadOptions);
    const uploadStore=new MongoOperationStore(uploadOptions,MONGO_IMPORT_UPLOAD_MODELS), data=new FormData();
    data.set("file",new File([JSON.stringify([{companyName:"Synthetic Company",courseName:"Synthetic Course",startDate:"2031-01-02",endDate:"2031-01-03"}])],"synthetic.json",{type:"application/json"}));
    data.set("sourceName","Synthetic private source");
    const uploaded=await uploadRoute.POST(new Request("https://example.invalid/api/admin/imports/upload",{method:"POST",body:data})); assert.equal(uploaded.status,200);
    const body=await uploaded.json(); assert.equal(body.ok,true); assert.equal(body.storedCount,1); assert.ok(await uploadStore.one("ActivityRequest",{_id:uploaded.headers.get("X-Request-Id")!}));
    const raw=await uploadStore.collection("DataImportRun").findOne({_id:body.importRunId}); assert.match(String(raw?.sourceName),/^pii:v1:fixture:/); assert.ok(!JSON.stringify(raw).includes("Synthetic private source")); assert.equal(pgCalls,0);

    const partialNamespace=`shadow_import_partial_${randomBytes(6).toString("hex")}`,partialOptions={client,databaseName,namespace:partialNamespace,allowShadowWrites:true as const};
    await client.db(databaseName).createCollection(`${partialNamespace}_LegacyOnly`,{validator:{marker:{$type:"string"}},validationLevel:"strict",validationAction:"error"});
    await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`).createIndex({marker:1},{unique:true,name:"marker_unique"}); await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`).insertOne({marker:"unchanged"});
    const partial=new MongoOperationStore(partialOptions),before=await snapshot(partial); writes.length=0;
    await assert.rejects(prepareMongoImportTemplateRuntime(partialOptions),/MONGO_IMPORT_TEMPLATE_RUNTIME_FAILED/); await assert.rejects(prepareMongoImportUploadRuntime(partialOptions),/MONGO_IMPORT_UPLOAD_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event=>event.commandName),[]); assert.deepEqual(await snapshot(partial),before);
    process.env.MONGODB_SHADOW_NAMESPACE=partialNamespace;
    await assert.rejects(templateRoute.GET(),/IMPORT_STAGING_COMPOSITION_FAILED/);
    const blocked=new FormData(); blocked.set("file",new File(["[]"],"blocked.json",{type:"application/json"})); await assert.rejects(uploadRoute.POST(new Request("https://example.invalid/api/admin/imports/upload",{method:"POST",body:blocked})),/IMPORT_STAGING_COMPOSITION_FAILED/);
    assert.deepEqual(await snapshot(partial),before); assert.equal(pgCalls,0);
  }finally{try{await client.db(databaseName).dropDatabase();}catch{} await client.close(); for(const [name,value] of saved){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
