/** Separate runner preserves original gate test bytes while parent executes it. */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { test } from "node:test";
import { verifyClosure } from "./frozen-loader.fixture.ts";
test("Sheets independent original/current/native full handler parity",{skip:process.env.SHEETS_IMPORT_PARITY!=="1",timeout:1_900_000,concurrency:false},async t=>{
 verifyClosure();
 assert.equal(process.env.PG_SHEETS_TEST_DATABASE_URL,"postgresql://synthetic@127.0.0.1:56751/sheets_import_test");
 assert.equal(process.env.PG_SHEETS_TEST_DATA_DIRECTORY,"/private/tmp/hub-om-google-sheets-import-20260930/pg");
 assert.equal(process.env.MONGODB_SHEETS_TEST_URI,"mongodb://127.0.0.1:27851/?replicaSet=sheetsimport20260930");
 async function run(file:URL,args:string[],cleanupRequired:boolean){
  const env=Object.fromEntries(["PATH","HOME","TMPDIR","PG_SHEETS_TEST_DATABASE_URL","PG_SHEETS_TEST_DATA_DIRECTORY","MONGODB_SHEETS_TEST_URI"].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]!]]));
  const worker=fork(file,args,{env:{...env,NODE_ENV:"test",LC_ALL:"C"},execArgv:["--experimental-strip-types","--experimental-loader",new URL("../../../../scripts/ts-loader.mjs",import.meta.url).pathname],stdio:["ignore","pipe","pipe","ipc"]});
  let stdout="",stderr="",failure="",cleanup=false,result:{ledger?:Array<{name:string;value:unknown}>}|undefined;
  worker.stdout?.on("data",v=>{stdout+=String(v);});worker.stderr?.on("data",v=>{stderr+=String(v);});
  worker.on("message",value=>{const m=value as {kind:string;remaining?:number;message?:string;ledger?:Array<{name:string;value:unknown}>};if(m.kind==="result")result=m;else if(m.kind==="cleanup")cleanup=m.remaining===0;else if(m.kind==="failure")failure=m.message??"worker failure";if(m.kind!=="result")t.diagnostic(JSON.stringify(m));});
  await new Promise<void>((resolve,reject)=>{let timedOut=false;let escalation:ReturnType<typeof setTimeout>|undefined;const timer=setTimeout(()=>{timedOut=true;worker.kill("SIGTERM");escalation=setTimeout(()=>{worker.kill("SIGKILL");},5000);},180_000);
   worker.once("error",e=>{if(worker.pid===undefined){clearTimeout(timer);reject(e);}});
   worker.once("exit",(code,signal)=>{clearTimeout(timer);clearTimeout(escalation);if(timedOut)reject(new Error(`TIMEOUT observed exit=${code}/${signal}. STOP workers. OWNED RESOURCE AUDIT REQUIRED, cleanup NOT confirmed.\n${stdout}\n${stderr}`));else if(code!==0||signal||failure||!result||(cleanupRequired&&!cleanup))reject(new Error(`${file.pathname} ${args.join(',')} exit=${code}/${signal}; cleanup=${cleanup}; ${failure}\n${stdout}\n${stderr}`));else resolve();});
  });assert.ok(result);return result;
 }
 for(const origin of ["src/lib/data/importRepositoryFactory.ts","src/lib/data/prismaImportRepository.ts","src/lib/data/importReviewPresenter.ts"])
  for(const mode of ["frozen-byte","undeclared-current-import"])await run(new URL("./closure-negative-worker.fixture.ts",import.meta.url),[mode,origin],false);
 await run(new URL("./closure-negative-worker.fixture.ts",import.meta.url),["actual-loader-byte"],false);
 let baseline:Array<{name:string;value:unknown}>|undefined;
 for(const backend of ["original","current","mongo"]){
  const result=await run(new URL("../../../../src/lib/data/sheetsImportParityWorker.fixture.ts",import.meta.url),[backend],true);assert.ok(result.ledger&&result.ledger.length>=20);
  for(const name of ["boundary199-stored","boundary201-stored","year-number-2000","year-number-2100","actual-summary-order-and-complete-bijection","known-instructor-whole-tuple","unknown-instructor-whole-tuple","notice-blank-physical-whole-tuple","partial-retry-whole-tuple","alias-team1-stored","alias-team2-stored","trimmed-source-stored","preview201-wholeDTO-three-negative-controls","race-overlap-reads-first-stored","race-overlap-reads-before-commit","race-first-commit-before-second-read-stored","race-first-commit-before-second-read-duplicate","race-first-commit-before-second-read-order"])assert.ok(result.ledger.some(row=>row.name===name),name);
  for(const [name,count] of [["race-overlap-reads-first-stored",2],["race-overlap-reads-before-commit",1],["race-first-commit-before-second-read-stored",1],["race-first-commit-before-second-read-duplicate",1],["race-first-commit-before-second-read-order",1]] as const)assert.equal(result.ledger.filter(row=>row.name===name).length,count,`${backend}: ${name} tuple count`);
  if(backend==="original")baseline=result.ledger;
  else assert.deepEqual(result.ledger,baseline,`${backend} differs from original independent literal ledger`);
  t.diagnostic(JSON.stringify({backend,ledger:result.ledger}));
 }
});
