import assert from "node:assert/strict";
import test from "node:test";
import { runImportPromotionRequest, type ImportPromotionCompositionDependencies } from "./importPromotionComposition";

const key=Buffer.alloc(32,1).toString("base64"),indexKey=Buffer.alloc(32,2).toString("base64");
const env={IMPORT_PROMOTION_BACKEND:"mongodb-shadow",MONGODB_URI:"mongodb://127.0.0.1:27017",MONGODB_SHADOW_DATABASE:"hub_om_shadow_promotion_composition",MONGODB_SHADOW_NAMESPACE:"shadow_promotion_composition",PII_ENCRYPTION_KEYS:JSON.stringify({fixture:key}),PII_ACTIVE_KEY_ID:"fixture",PII_INDEX_KEY:indexKey};
function fixture(failure?:"connect"|"open"|"work"|"close"){
  const seen:string[]=[];
  const dependencies:ImportPromotionCompositionDependencies={createClient(){seen.push("client");return{async connect(){seen.push("connect");if(failure==="connect")throw new Error("private");},async close(){seen.push("close");if(failure==="close")throw new Error("private");}};},async openRuntime(input){seen.push("open");assert.equal(input.reflectOperations,false);if(failure==="open")throw new Error("private");return{async run<T>(work:()=>Promise<T>){seen.push("run");return work();}};}};
  const work=async()=>{seen.push("work");if(failure==="work")throw new Error("private");return"ok";}; return{seen,dependencies,work};
}
test("promotion defaults to PostgreSQL without loading Mongo",async()=>{const f=fixture();assert.equal(await runImportPromotionRequest(f.work,{},f.dependencies),"ok");assert.deepEqual(f.seen,["work"]);});
test("exact Mongo selector opens and closes one Calendar runtime",async()=>{const f=fixture();assert.equal(await runImportPromotionRequest(f.work,env,f.dependencies),"ok");assert.deepEqual(f.seen,["client","connect","open","run","work","close"]);});
test("invalid selector and configuration fail before client",async()=>{for(const candidate of [{IMPORT_PROMOTION_BACKEND:"mongo"},{IMPORT_PROMOTION_BACKEND:"mongodb-shadow"},{...env,MONGODB_URI:""},{...env,PII_INDEX_KEY:key}]){const f=fixture();await assert.rejects(runImportPromotionRequest(f.work,candidate,f.dependencies),/^Error: IMPORT_PROMOTION_COMPOSITION_FAILED$/);assert.deepEqual(f.seen,[]);}});
test("Mongo failures are private and owned clients close",async()=>{for(const failure of ["connect","open","work"] as const){const f=fixture(failure);await assert.rejects(runImportPromotionRequest(f.work,env,f.dependencies),/^Error: IMPORT_PROMOTION_COMPOSITION_FAILED$/);assert.ok(f.seen.filter(x=>x==="work").length<=1);assert.equal(f.seen.at(-1),"close");}});
test("close failure preserves completed result",async()=>{const f=fixture("close");assert.equal(await runImportPromotionRequest(f.work,env,f.dependencies),"ok");});
