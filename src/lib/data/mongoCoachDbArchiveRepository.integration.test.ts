import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { MongoCoachDbArchiveRepository, prepareMongoCoachDbArchiveStore } from "./mongoCoachDbArchiveRepository";
const uri = process.env.MONGODB_COACH_DB_ARCHIVE_TEST_URI;
test("coach db archive writes encrypted Mongo snapshots atomically", { skip: !uri, timeout: 120_000 }, async () => {
  const parsed = new URL(uri!); assert.equal(parsed.hostname, "127.0.0.1"); assert.equal(parsed.username, "");
  const names=["PII_ACTIVE_KEY_ID","PII_ENCRYPTION_KEYS","PII_INDEX_KEY","PII_ALLOW_PLAINTEXT_READS"] as const,saved=new Map(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{PII_ACTIVE_KEY_ID:"archive-mongo",PII_ENCRYPTION_KEYS:JSON.stringify({"archive-mongo":randomBytes(32).toString("base64")}),PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false"});
  const client=new MongoClient(uri!,{directConnection:true,serverSelectionTimeoutMS:5_000}),databaseName=`hub_om_shadow_archive_${randomBytes(4).toString("hex")}`,namespace=`shadow_archive_${randomBytes(4).toString("hex")}`;
  const input={sourceDatabase:"configured-postgresql-source",sourceSchema:"public" as const,tables:[{schema:"public",name:"coaches",rowCount:1,rows:[{rowKey:"mongo-private-key",rowData:{name:"Mongo Private Name"}}]}]};
  try { await client.connect(); const options={client,databaseName,namespace,allowShadowWrites:true as const}; await prepareMongoCoachDbArchiveStore(options); const repository=await MongoCoachDbArchiveRepository.open(options);
    await repository.archive(input,false); assert.equal(await client.db(databaseName).collection(`${namespace}_CoachdbArchiveSnapshot`).countDocuments(),0);
    await repository.archive(input,true); await repository.archive(input,true); assert.equal(await client.db(databaseName).collection(`${namespace}_CoachdbArchiveSnapshot`).countDocuments({status:"completed"}),2);
    const raw=JSON.stringify(await client.db(databaseName).collection(`${namespace}_CoachdbArchiveRow`).find({}).toArray()); assert.doesNotMatch(raw,/mongo-private-key|Mongo Private Name/); assert.match(raw,/rowKeyPiiIndex/);
    const rows=Array.from({length:250},(_,index)=>({rowKey:`late-${index}`,rowData:{index}}));rows.push(rows[0]);
    const duplicate={...input,tables:[{schema:"public",name:"late_failure",rowCount:rows.length,rows}]};
    const snapshots=client.db(databaseName).collection(`${namespace}_CoachdbArchiveSnapshot`),archiveRows=client.db(databaseName).collection(`${namespace}_CoachdbArchiveRow`);
    const before=JSON.stringify([await snapshots.find({}).sort({_id:1}).toArray(),await archiveRows.find({}).sort({_id:1}).toArray()]); await assert.rejects(()=>repository.archive(duplicate,true));
    const after=JSON.stringify([await snapshots.find({}).sort({_id:1}).toArray(),await archiveRows.find({}).sort({_id:1}).toArray()]);assert.equal(after,before);
  } finally { let cleanupError:unknown; try { await client.db(databaseName).dropDatabase(); } catch(error){cleanupError=error;} try { await client.close(); } catch(error){cleanupError??=error;}
    try { for(const name of names){const value=saved.get(name);if(value===undefined)delete process.env[name];else process.env[name]=value;} } finally { if(cleanupError) throw cleanupError; } }
});
