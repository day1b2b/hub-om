/** Separate runner preserves original gate test bytes while parent executes it. */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { test } from "node:test";
import { verifyClosure } from "./frozen-loader.fixture.ts";
test("Notion independent original/current/native full handler parity",{skip:process.env.NOTION_IMPORT_PARITY!=="1",timeout:1_900_000,concurrency:false},async t=>{
 verifyClosure();
 assert.equal(process.env.PG_NOTION_TEST_DATABASE_URL,"postgresql://synthetic@127.0.0.1:56752/notion_import_test");
 assert.equal(process.env.PG_NOTION_TEST_DATA_DIRECTORY,"/private/tmp/hub-om-notion-import-20260930/pg");
 assert.equal(process.env.MONGODB_NOTION_TEST_URI,"mongodb://127.0.0.1:27852/?replicaSet=notionimport20260930");
 async function run(file:URL,args:string[],cleanupRequired:boolean){
  const env=Object.fromEntries(["PATH","HOME","TMPDIR","PG_NOTION_TEST_DATABASE_URL","PG_NOTION_TEST_DATA_DIRECTORY","MONGODB_NOTION_TEST_URI"].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]!]]));
  const worker=fork(file,args,{env:{...env,NODE_ENV:"test",LC_ALL:"C"},execArgv:["--experimental-strip-types","--experimental-loader",new URL("../../../../scripts/ts-loader.mjs",import.meta.url).pathname],stdio:["ignore","pipe","pipe","ipc"]});
  let stdout="",stderr="",failure="",cleanup=false,result:{ledger?:Array<{name:string;value:unknown}>;nativeIsolation?:{kind:string;results:unknown[];sourceArrivals:number;sharedServerTokenUnchanged:boolean;identityEvidence:Array<{runs:number;rows:number;audits:number;negativeControls:number}>}}|undefined;
  worker.stdout?.on("data",v=>{stdout+=String(v);});worker.stderr?.on("data",v=>{stderr+=String(v);});
  worker.on("message",value=>{const m=value as {kind:string;remaining?:number;message?:string;ledger?:Array<{name:string;value:unknown}>;nativeIsolation?:{kind:string;results:unknown[];sourceArrivals:number;sharedServerTokenUnchanged:boolean;identityEvidence:Array<{runs:number;rows:number;audits:number;negativeControls:number}>}};if(m.kind==="result")result=m;else if(m.kind==="cleanup")cleanup=m.remaining===0;else if(m.kind==="failure")failure=m.message??"worker failure";if(m.kind!=="result")t.diagnostic(JSON.stringify(m));});
  await new Promise<void>((resolve,reject)=>{let timedOut=false;let escalation:ReturnType<typeof setTimeout>|undefined;const timer=setTimeout(()=>{timedOut=true;worker.kill("SIGTERM");escalation=setTimeout(()=>{worker.kill("SIGKILL");},5000);},180_000);
   worker.once("error",e=>{if(worker.pid===undefined){clearTimeout(timer);reject(e);}});
   worker.once("exit",(code,signal)=>{clearTimeout(timer);clearTimeout(escalation);if(timedOut)reject(new Error(`TIMEOUT observed exit=${code}/${signal}. STOP workers. OWNED RESOURCE AUDIT REQUIRED, cleanup NOT confirmed.\n${stdout}\n${stderr}`));else if(code!==0||signal||failure||!result||(cleanupRequired&&!cleanup))reject(new Error(`${file.pathname} ${args.join(',')} exit=${code}/${signal}; cleanup=${cleanup}; ${failure}\n${stdout}\n${stderr}`));else resolve();});
  });assert.ok(result);return result;
 }
 for(const origin of ["src/app/api/admin/imports/notion/import/route.ts","src/lib/data/notionImport.ts","src/lib/data/importRepositoryFactory.ts","src/lib/data/prismaImportRepository.ts","src/lib/data/importReviewPresenter.ts"])
  for(const mode of ["frozen-byte","undeclared-current-import"])await run(new URL("./closure-negative-worker.fixture.ts",import.meta.url),[mode,origin],false);
 await run(new URL("./closure-negative-worker.fixture.ts",import.meta.url),["actual-loader-byte"],false);
 let baseline:Array<{name:string;value:unknown}>|undefined;
 for(const backend of ["original","current","mongo"]){
  const result=await run(new URL("../../../../src/lib/data/notionImportParityWorker.fixture.ts",import.meta.url),[backend],true);assert.ok(result.ledger&&result.ledger.length>=20);
  for(const name of ["whole-store-ID-parent-bijection", "normal", "all-duplicate", "valid-roster", "known-instructor", "blank-instructor", "unknown-instructor", "date-and-role-errors", "empty-properties-required-fields", "literal-negative-controls", "alias-team1", "alias-team2", "team2", "unknown-team", "source-default", "source-whitespace", "source-trim", "same-name-other-team", "same-row-other-name", "same-upload-duplicate-pages", "partial-seed", "partial-retry", "same-mapped-business-different-page-id", "historical-seed", "historical-other-source-type", "historical-notion-duplicate", "historical-unknown-seed", "historical-unknown-source-type", "boundary199", "boundary201", "preview201-wholeDTO-three-negative-controls", "default-backend-env-local", "default-backend-env-notion", "default-backend-env-synthetic-unknown", "race-overlap-read-barrier", "race-sequential-first", "race-sequential-second", "race-sequential-commit-barrier", "late-http-no-staging", "late-transport-no-staging", "late-json-no-staging", "sourceName-number-normal", "sourceName-number-empty", "summary-real-order-tie-complete-bijection", "recovery-after-source-failure"])assert.equal(result.ledger.filter(row=>row.name===name).length,1,`${backend}: required case ${name}`);
  assert.equal(result.ledger.filter(row=>row.name==="race-overlap-tuple").length,2,`${backend}: both overlap tuples required`);
  if(backend==="original")baseline=result.ledger;
  else assert.deepEqual(result.ledger,baseline,`${backend} differs from original independent literal ledger`);
  if(backend==="mongo"){assert.ok(result.nativeIsolation);assert.equal(result.nativeIsolation.kind,"native-isolation");assert.equal(result.nativeIsolation.results.length,5);assert.equal(result.nativeIsolation.sourceArrivals,2);assert.equal(result.nativeIsolation.sharedServerTokenUnchanged,true);assert.deepEqual(result.nativeIsolation.identityEvidence,[{runs:2,rows:4,audits:2,negativeControls:8},{runs:2,rows:4,audits:3,negativeControls:8}]);}
  else assert.equal(result.nativeIsolation,undefined);
  t.diagnostic(JSON.stringify({backend,ledger:result.ledger,nativeIsolation:result.nativeIsolation}));
 }
});
