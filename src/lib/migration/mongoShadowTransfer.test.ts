import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { shadowContentDigest, transferMongoShadow, type ShadowCodec, type ShadowDocument, type ShadowPlan, type ShadowSource, type ShadowTarget } from "./mongoShadowTransfer";
function fixture() {
  const codec: ShadowCodec = { models: ["Fixture"], encode: (_model, row) => structuredClone(row as ShadowDocument),
    hash: (_model, document) => createHash("sha256").update(JSON.stringify(document)).digest("hex") };
  const rows: ShadowDocument[] = [{ _id: "a", value: "encrypted-a" }, { _id: "b", value: "encrypted-b" }];
  const records = new Map<string, ShadowDocument>();
  const key = (ns: string, model: string, id: string) => JSON.stringify([ns, model, id]);
  const source: ShadowSource = { assertSnapshot: async () => {}, page: async (_snapshot, _model, after, limit) => rows.filter(r => after === null || r._id > after).slice(0, limit) };
  const target: ShadowTarget = { databaseName: "shadow_fixture", insertOnly: async (ns, model, doc) => {
    const k = key(ns, model, doc._id); if (records.has(k)) return false;
    records.set(k, structuredClone(doc)); return true;
  }, get: async (ns, model, id) => structuredClone(records.get(key(ns, model, id)) ?? null),
  page: async (ns, model, after, limit) => [...records.entries()].filter(([k, v]) => {
    const [n, m] = JSON.parse(k); return n === ns && m === model && (after === null || v._id > after);
  }).map(([, v]) => structuredClone(v)).sort((a,b) => a._id < b._id ? -1 : 1).slice(0, limit),
  count: async (ns, model) => [...records.keys()].filter(k => { const [n,m] = JSON.parse(k);return n === ns && m === model; }).length };
  const plan: ShadowPlan = { runId: "fixture", snapshotId: "snapshot-1", sourceConsistency: "exported-snapshot", targetDatabase: target.databaseName,
    productionDatabase: "production", allowShadowWrites: true, batchSize: 1,
    expected: { Fixture: { count: rows.length, digest: shadowContentDigest(rows.map(row => ({ id: row._id, hash: codec.hash("Fixture", row) }))) } } };
  const references = async () => ({ verified: true as const, evidenceId: "synthetic-reference-check" });
  return { codec, rows, records, source, target, plan, references,
    run: () => transferMongoShadow(plan, source, target, codec, references) };
}
test("bounded copy, exact destination audit and immutable retry never authorize cutover", async () => {
  const f = fixture();const one = await f.run();const size = f.records.size;
  assert.equal(one.status, "shadow-verified");assert.equal(one.cutoverAuthorized, false);assert.equal(one.liveChangesSynchronized,false);
  assert.equal(one.finalFrozenRunRequired,true);assert.deepEqual(await f.run(),one);assert.equal(f.records.size,size);
});
test("production name / missing explicit gate reject before any write", async () => {
  for (const change of ["name", "gate"]) {
    const f = fixture();if(change === "name") f.plan.productionDatabase=f.plan.targetDatabase;else Object.assign(f.plan,{allowShadowWrites:false});
    await assert.rejects(f.run(), /SHADOW_WRITE_GATE/);assert.equal(f.records.size,0);
  }
});
test("changed snapshot identity cannot reuse run namespace", async () => {
  const f=fixture();await f.run();f.plan.snapshotId="snapshot-2";await assert.rejects(f.run(),/RUN_REUSE_MISMATCH/);
});
test("duplicate id with altered stored ciphertext is not overwritten", async () => {
  const f=fixture();await f.run();await f.target.insertOnly("shadow_fixture","Fixture",{_id:"a",value:"replacement"});
  const entry=[...f.records.values()].find(row=>row._id==="a")!;entry.value="tampered";
  await assert.rejects(f.run(),/TARGET_READBACK/);assert.equal(entry.value,"tampered");
});
test("extra target rows and paged content tampering fail independent audit", async () => {
  const f=fixture();await f.run();await f.target.insertOnly("shadow_fixture","Fixture",{_id:"z",value:"extra"});
  await assert.rejects(f.run(),/TARGET_COUNT/);
  const g=fixture();const page=g.target.page;g.target.page=async(...args)=>(await page(...args)).map(row=>({...row,value:"changed"}));
  await assert.rejects(g.run(),/TARGET_MANIFEST_MISMATCH/);
});
test("missing/changing snapshot, wrong source manifest and repeated cursor fail closed",async()=>{
  const a=fixture();a.source.assertSnapshot=async()=>{throw new Error("snapshot expired");};await assert.rejects(a.run(),/snapshot expired/);assert.equal(a.records.size,0);
  const b=fixture();b.rows[0].value="changed source";await assert.rejects(b.run(),/SOURCE_MANIFEST_MISMATCH/);
  const c=fixture();c.source.page=async()=>[c.rows[0]];await assert.rejects(c.run(),/SOURCE_ORDER/);
});
test("reference check is mandatory and snapshot remains checked after it",async()=>{
  const f=fixture();await assert.rejects(transferMongoShadow(f.plan,f.source,f.target,f.codec,async()=>({verified:true,evidenceId:""})),/REFERENCE_GATE/);
  const g=fixture();await assert.rejects(transferMongoShadow(g.plan,g.source,g.target,g.codec,async()=>{g.source.assertSnapshot=async()=>{throw new Error("expired");};return {verified:true,evidenceId:"check"};}),/expired/);
});
test("model coverage and total work bounds reject before writes",async()=>{
  const f=fixture();f.plan.expected={};await assert.rejects(f.run(),/MODEL_COVERAGE/);assert.equal(f.records.size,0);
  const g=fixture();g.plan.maxRows=1;await assert.rejects(g.run(),/ROW_LIMIT/);assert.equal(g.records.size,0);
});
test("partial copy resumes without replacing durable rows",async()=>{
  const f=fixture();const original=f.target.insertOnly;let fail=true;
  f.target.insertOnly=async(ns,model,doc)=>{if(fail && doc._id==="b") throw new Error("storage unavailable");return original(ns,model,doc);};
  await assert.rejects(f.run(),/storage unavailable/);const before=await f.target.get("shadow_fixture","Fixture","a");
  fail=false;await f.run();assert.deepEqual(await f.target.get("shadow_fixture","Fixture","a"),before);
});
test("empty models are verified and frozen runs still do not authorize cutover",async()=>{
  const f=fixture();f.rows.length=0;f.plan.expected.Fixture={count:0,digest:shadowContentDigest([])};f.plan.sourceConsistency="frozen-source";
  const result=await f.run();assert.equal(result.finalFrozenRunRequired,false);assert.equal(result.cutoverAuthorized,false);assert.equal(result.counts.Fixture,0);
});
