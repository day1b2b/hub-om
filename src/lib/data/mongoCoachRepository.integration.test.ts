import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { MongoCoachRepository } from "./mongoCoachRepository";
import { MongoCoachPrivateRepository } from "./mongoCoachPrivateRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { COACH_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { mongoCoachFixtures } from "./mongoCoachFixtures";
const uri=process.env.MONGODB_COACH_TEST_URI;
/** Explicit disposable loopback target only, never MONGODB_URI or an env file. */
test("Coach repositories: encrypted native Mongo relations and eight read methods",{skip:!uri,timeout:120_000},async()=>{
  const url=new URL(uri!);assert.equal(url.protocol,"mongodb:");assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname));assert.ok(url.port);assert.equal(url.username,"");assert.equal(url.password,"");assert.ok(url.pathname===""||url.pathname==="/");
  const client=new MongoClient(uri!,{serverSelectionTimeoutMS:5000,monitorCommands:true});const databaseName=`hub_om_shadow_coach_test_${randomBytes(10).toString("hex")}`;
  let monitorReads=false;const observedCommands:string[]=[];
  client.on("commandStarted",event=>{if(monitorReads)observedCommands.push(event.commandName);});
  const names=["PII_ENCRYPTION_KEYS","PII_ACTIVE_KEY_ID","PII_INDEX_KEY","PII_ALLOW_PLAINTEXT_READS","SKILLFLO_COACH_URL_TEMPLATE"];const saved=new Map(names.map(name=>[name,process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS=JSON.stringify({fixture:randomBytes(32).toString("base64")});process.env.PII_ACTIVE_KEY_ID="fixture";process.env.PII_INDEX_KEY=randomBytes(32).toString("base64");process.env.PII_ALLOW_PLAINTEXT_READS="false";process.env.SKILLFLO_COACH_URL_TEMPLATE="https://coach.example.invalid/{token}";
  const options={client,databaseName,namespace:`shadow_test_${randomBytes(10).toString("hex")}`};let connected=false;
  try {
    await client.connect();connected=true;
    await assert.rejects(MongoCoachRepository.open(options));
    await prepareMongoReadStore({...options,allowShadowWrites:true},COACH_READ_MODELS);
    const store=new MongoOperationStore(options,COACH_READ_MODELS),fixture=mongoCoachFixtures();
    for(const [model,rows] of fixture.data)await store.collection(model).insertMany(rows.map(row=>encodeMongoRuntimeDocument(model,row)));
    monitorReads=true;
    const mongo=await MongoCoachRepository.open(options),priv=await MongoCoachPrivateRepository.open(options),id=fixture.a.id as string;
    const summary=(await mongo.listCoaches()).find(row=>row.id===id)!;assert.equal(summary.avgRating,3);assert.equal(summary.workDayCount,1);assert.deepEqual(summary.fields,["Synthetic field"]);
    assert.ok(!(await mongo.listCoaches()).some(row=>row.id===fixture.deleted.id));assert.ok(await mongo.getCoachById(fixture.deleted.id as string));
    const detail=await mongo.getCoachById(id);assert.equal(detail?.statusNote,"latest");assert.deepEqual(detail?.curriculums,["Synthetic curriculum"]);assert.equal(detail?.coachInputUrl,"https://coach.example.invalid/synthetic-token");
    assert.equal((await mongo.listEngagements(id))[0].courseName,"Synthetic second");
    const range={from:"2099-12-01",to:"2099-12-31"};assert.equal((await mongo.listSchedules(id,range)).length,2);assert.equal((await mongo.listEngagementSchedules(id,range)).length,2);
    const dashboard=await mongo.getScheduleDashboard("2099-12");assert.equal(dashboard.totalActiveCoaches,2);assert.equal(dashboard.days["2099-12-01"].coaches.find(row=>row.id===id)?.reservation?.reservedByName,"Synthetic reserver");
    assert.equal((await priv.getPrivateProfile(id))?.birthDate,"2000-01-02");assert.equal((await priv.getPrivateProfile(id))?.email,"synthetic-profile@example.invalid");assert.equal(await priv.getPrivateProfile("00000000-0000-4000-8000-000000000000"),null);
    assert.ok((await priv.getEngagementFeedback(id)).some(row=>row.hiredByText==="Synthetic private hirer"));
    const stored=await store.collection("CoachPrivateProfile").findOne({_id:id});assert.ok(stored);assert.ok(!JSON.stringify(stored).includes("synthetic-profile@example.invalid"));
    monitorReads=false;
    const writeCommands=new Set(["insert","update","delete","create","collMod","createIndexes","drop","dropIndexes","findAndModify","bulkWrite"]);
    assert.ok(observedCommands.includes("find"),"Monitor must observe actual reads");
    assert.deepEqual(observedCommands.filter(command=>writeCommands.has(command)),[],"Repository open/read must never write or prepare collections");
    // Rotation must preserve historical ciphertext; removing its old key fails closed.
    const originalKeys=process.env.PII_ENCRYPTION_KEYS!,originalActive=process.env.PII_ACTIVE_KEY_ID!;
    const rotatedKey=randomBytes(32).toString("base64");
    try {
      process.env.PII_ENCRYPTION_KEYS=JSON.stringify({...JSON.parse(originalKeys),rotated:rotatedKey});process.env.PII_ACTIVE_KEY_ID="rotated";
      assert.equal((await priv.getPrivateProfile(id))?.email,"synthetic-profile@example.invalid");
      process.env.PII_ENCRYPTION_KEYS=JSON.stringify({rotated:rotatedKey});
      await assert.rejects(priv.getPrivateProfile(id),/COACH_READ_FAILED/);
      process.env.PII_ENCRYPTION_KEYS=originalKeys;process.env.PII_ACTIVE_KEY_ID=originalActive;
      assert.equal((await priv.getPrivateProfile(id))?.email,"synthetic-profile@example.invalid");
    } finally {process.env.PII_ENCRYPTION_KEYS=originalKeys;process.env.PII_ACTIVE_KEY_ID=originalActive;}
    // Retain valid envelope shape while breaking field authentication.
    const original=stored.email as string;const parts=original.split(":");parts[4]=(parts[4][0]==="A"?"B":"A")+parts[4].slice(1);
    await store.collection("CoachPrivateProfile").updateOne({_id:id},{$set:{email:parts.join(":")}});
    await assert.rejects(priv.getPrivateProfile(id),/COACH_READ_FAILED/);
    await store.collection("CoachPrivateProfile").updateOne({_id:id},{$set:{email:original}});
    assert.equal((await priv.getPrivateProfile(id))?.email,"synthetic-profile@example.invalid");
    // A valid ciphertext from another field must not pass this field's AAD check.
    await store.collection("CoachPrivateProfile").updateOne({_id:id},{$set:{email:stored.phone}});
    await assert.rejects(priv.getPrivateProfile(id),/COACH_READ_FAILED/);
    await store.collection("CoachPrivateProfile").replaceOne({_id:id},stored);
    const index=stored.emailPiiIndex as string;
    await store.collection("CoachPrivateProfile").updateOne({_id:id},{$set:{emailPiiIndex:(index[0]==="a"?"b":"a")+index.slice(1)}});
    await assert.rejects(priv.getPrivateProfile(id),/COACH_READ_FAILED/);
    await store.collection("CoachPrivateProfile").replaceOne({_id:id},stored);
    // Intentional test-only corruption bypasses the validator to exercise decoder coverage.
    await store.collection("CoachPrivateProfile").updateOne({_id:id},{$unset:{emailPiiIndex:""}},{bypassDocumentValidation:true});
    await assert.rejects(priv.getPrivateProfile(id),/COACH_READ_FAILED/);
    await store.collection("CoachPrivateProfile").replaceOne({_id:id},stored);
    assert.equal((await priv.getPrivateProfile(id))?.email,"synthetic-profile@example.invalid");
    // Same primary keys in another prepared namespace must remain independent.
    const secondOptions={...options,namespace:`shadow_test_${randomBytes(10).toString("hex")}`};
    await prepareMongoReadStore({...secondOptions,allowShadowWrites:true},COACH_READ_MODELS);
    const secondStore=new MongoOperationStore(secondOptions,COACH_READ_MODELS);
    await secondStore.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach",{...fixture.a,name:"Synthetic second namespace",normalizedName:"syntheticsecondnamespace"}));
    const profile=fixture.data.get("CoachPrivateProfile")![0];
    await secondStore.collection("CoachPrivateProfile").insertOne(encodeMongoRuntimeDocument("CoachPrivateProfile",{...profile,email:"second-namespace@example.invalid"}));
    const second=await MongoCoachRepository.open(secondOptions),secondPrivate=await MongoCoachPrivateRepository.open(secondOptions);
    assert.equal((await second.getCoachById(id))?.name,"Synthetic second namespace");
    assert.equal((await mongo.getCoachById(id))?.name,fixture.a.name);
    assert.equal((await secondPrivate.getPrivateProfile(id))?.email,"second-namespace@example.invalid");
    assert.equal((await priv.getPrivateProfile(id))?.email,"synthetic-profile@example.invalid");
  } finally {
    try {if(connected)await client.db(databaseName).dropDatabase();}
    finally {try {await client.close();} finally {for(const name of names){const value=saved.get(name);if(value===undefined)delete process.env[name];else process.env[name]=value;}}}
  }
});
