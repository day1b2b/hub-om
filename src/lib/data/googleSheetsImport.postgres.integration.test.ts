/** Parent-owned execution only. Frozen PG gate precedes current/native parity. */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { test } from "node:test";
import { verifyClosure } from "../../../.claude/plans/mongodb-google-sheets-import/original/frozen-loader.fixture.ts";
const enabled=process.env.PG_SHEETS_TEST_DATABASE_URL;
test("Sheets frozen original PG observation gate",{skip:enabled===undefined,timeout:200_000},async t=>{
  assert.equal(enabled,"postgresql://synthetic@127.0.0.1:56751/sheets_import_test");
  assert.equal(process.env.PG_SHEETS_TEST_DATA_DIRECTORY,"/private/tmp/hub-om-google-sheets-import-20260930/pg");
  const manifest=verifyClosure();t.diagnostic(`baseline=${manifest.baseline}; files=${manifest.files.length}`);
  const inherited=Object.fromEntries(["PATH","HOME","TMPDIR","PG_SHEETS_TEST_DATABASE_URL","PG_SHEETS_TEST_DATA_DIRECTORY"].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]!]]));
  const child=fork(new URL("../../../.claude/plans/mongodb-google-sheets-import/original/pg-gate-worker.fixture.ts",import.meta.url),[],{
    env:{...inherited,NODE_ENV:"test",LC_ALL:"C"},execArgv:["--experimental-strip-types","--experimental-loader",new URL("../../../scripts/ts-loader.mjs",import.meta.url).pathname],stdio:["ignore","pipe","pipe","ipc"]
  });
  let stdout="",stderr="",result=false,cleanup=false,failure="",observations=0;
  child.stdout?.on("data",b=>{stdout+=String(b);});child.stderr?.on("data",b=>{stderr+=String(b);});
  child.on("message",value=>{
    const m=value as {kind:string;status?:string;remaining?:number;message?:string};
    t.diagnostic(JSON.stringify(m));
    if(m.kind==="observation")observations++;
    if(m.kind==="result")result=m.status==="ORIGINAL_OBSERVATIONS_ONLY_REVIEW_REQUIRED";
    if(m.kind==="cleanup")cleanup=m.remaining===0;
    if(m.kind==="failure")failure=m.message??"worker failure";
  });
  await new Promise<void>((resolve,reject)=>{
    let timedOut=false;let escalation:ReturnType<typeof setTimeout>|undefined;
    const timer=setTimeout(()=>{timedOut=true;child.kill("SIGTERM");escalation=setTimeout(()=>{child.kill("SIGKILL");},5000);},180_000);
    child.once("error",e=>{if(child.pid===undefined){clearTimeout(timer);reject(e);}});
    child.once("exit",(code,signal)=>{
      clearTimeout(timer);clearTimeout(escalation);
      if(timedOut)reject(new Error(`TIMEOUT observed exit=${code}/${signal}. STOP further workers. OWNED RESOURCE AUDIT REQUIRED; cleanup NOT confirmed.\n${stdout}\n${stderr}`));
      else if(code!==0||signal||failure||!result||!cleanup)reject(new Error(`exit=${code}/${signal}; result=${result}; cleanup=${cleanup}; ${failure}\n${stdout}\n${stderr}`));
      else resolve();
    });
  });
  assert.equal(observations,18);
  t.diagnostic("Original observations only; parent must review before current/native comparison. No product acceptance.");
});
