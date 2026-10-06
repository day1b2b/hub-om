import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exportPostgresShadow, type PostgresExportSnapshot, type PostgresExportCodec } from "./postgresShadowExport";
async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(),"hub-shadow-export-test-"));
  const directory=path.join(parent,"export");let finished=0;let aborted=0;
  const rows=[{_id:"a",personal:"PRIVATE-FIXTURE"},{_id:"b",personal:"PRIVATE-FIXTURE-2"}];
  const snapshot:PostgresExportSnapshot={snapshotId:"synthetic",isolation:"repeatable-read",readOnly:true,
    page:async(_model,after,limit)=>rows.filter(row=>after===null||row._id>after).slice(0,limit),sequenceHighWater:async()=>({"public.fixture_seq":"2"}),
    finish:async()=>{finished++;},abort:async()=>{aborted++;}};
  // Synthetic codec demonstrates that source values never pass directly to the file writer.
  const codec:PostgresExportCodec={models:["Fixture"],encode:(_model,row)=>({_id:row._id as string,personal:"encrypted-fixture"}),hash:(_model,doc)=>createHash("sha256").update(JSON.stringify(doc)).digest("hex")};
  return {parent,directory,rows,snapshot,codec,finished:()=>finished,aborted:()=>aborted,
    run:()=>exportPostgresShadow({directory,sourceMode:"plaintext",snapshot,codec,batchSize:1}),cleanup:()=>rm(parent,{recursive:true,force:true})};
}
test("durable encrypted spool contains only encoded rows and restricted files",async()=>{
  const f=await fixture();try{
    const result=await f.run();assert.equal(f.finished(),1);assert.equal(f.aborted(),0);
    assert.equal(result.manifest.models.Fixture.count,2);assert.equal(result.manifest.cutoverAuthorized,false);
    assert.equal(result.manifest.sequenceValuesRequireFrozenRecheck,true);
    const data=await readFile(path.join(f.directory,"Fixture.jsonl"),"utf8");assert.ok(!data.includes("PRIVATE-FIXTURE"));
    assert.equal((await stat(path.join(f.directory,"Fixture.jsonl"))).mode&0o777,0o600);
    assert.equal((await stat(path.join(f.directory,"manifest.json"))).mode&0o777,0o600);
    assert.equal((await stat(f.directory)).mode&0o777,0o700);
    assert.ok(!(await readdir(f.directory)).includes("manifest.pending"));
    assert.equal(JSON.parse(await readFile(path.join(f.directory,"manifest.json"),"utf8")).models.Fixture.digest,result.manifest.models.Fixture.digest);
  }finally{await f.cleanup();}
});
test("encoding failure or transaction failure leaves no usable manifest, preserves partial ciphertext",async()=>{
  for(const fail of ["encode","finish"]){const f=await fixture();try{
    if(fail==="encode") f.codec.encode=()=>{throw new Error("PRIVATE-ERROR");};else f.snapshot.finish=async()=>{throw new Error("PRIVATE-ERROR");};
    await assert.rejects(f.run(),error=>error instanceof Error&&error.message==="PostgreSQL shadow export failed: EXPORT_FAILED");
    assert.equal(f.aborted(),1);assert.ok(!(await readdir(f.directory)).includes("manifest.json"));
  }finally{await f.cleanup();}}
});
test("existing export is never overwritten",async()=>{
  const f=await fixture();try{await f.run();const before=await readFile(path.join(f.directory,"manifest.json"),"utf8");
    await assert.rejects(f.run(),/EXPORT_FAILED/);assert.equal(await readFile(path.join(f.directory,"manifest.json"),"utf8"),before);
  }finally{await f.cleanup();}
});
test("wrong isolation, traversal model and missing mode reject before files",async()=>{
  for(const issue of ["isolation","model","mode"]){const f=await fixture();try{
    if(issue==="isolation") Object.assign(f.snapshot,{readOnly:false});if(issue==="model") f.codec.models=["../secret"];
    await assert.rejects(exportPostgresShadow({directory:f.directory,sourceMode:issue==="mode"?undefined as never:"plaintext",snapshot:f.snapshot,codec:f.codec}));
    assert.deepEqual(await readdir(f.parent),[]);assert.equal(f.aborted(),1);
  }finally{await f.cleanup();}}
});
test("bounded rows and unstable ordering cannot produce completed manifest",async()=>{
  const f=await fixture();try{await assert.rejects(exportPostgresShadow({directory:f.directory,sourceMode:"plaintext",snapshot:f.snapshot,codec:f.codec,maxRows:1}),/ROW_LIMIT/);
    assert.ok(!(await readdir(f.directory)).includes("manifest.json"));
  }finally{await f.cleanup();}
});
test("CLI requires explicit read-only export intent, absolute directory and source mode",async()=>{
  const {parseShadowExportArguments}=await import("../../../scripts/export-mongodb-shadow");
  assert.deepEqual(parseShadowExportArguments(["--allow-read-only-source-export","--output-parent","/tmp","--source-mode","plaintext"]),{outputParent:"/tmp",sourceMode:"plaintext"});
  for(const args of [[],["--output-parent","/tmp","--source-mode","plaintext"],["--allow-read-only-source-export","--output-parent","relative","--source-mode","plaintext"],["--allow-read-only-source-export","--output-parent","/tmp","--source-mode","auto"],["--allow-read-only-source-export","--allow-read-only-source-export"]]) assert.throws(()=>parseShadowExportArguments(args),/EXPORT_ARGUMENTS/);
});
