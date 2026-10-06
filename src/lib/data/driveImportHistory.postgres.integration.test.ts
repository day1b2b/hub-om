/** Minimal original-PG take/collation gate. Coordinator runs; no product/current/native acceptance. */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { test } from "node:test";
import { verifyClosure } from "../../../.claude/plans/mongodb-drive-import-history/original/frozen-loader.fixture.ts";

const optIn = process.env.PG_DRIVE_HISTORY_TEST_DATABASE_URL;
const tags = [
  { kind: "omitted" }, { kind: "undefined" },
  ...[0, 1, 249, 250, 251, -1, -250, 1.5, 2_147_483_648, Number.MAX_SAFE_INTEGER].map(value => ({ kind: "number", value })),
  ...[0.5, -0.5, -1.5, -250.9, Number.MAX_VALUE, 1e20, 1e18, -1e18, 9_007_199_254_740_992, 1e-7].map(value => ({ kind: "number", value })),
  { kind: "negative-zero" },
  { kind: "nan" }, { kind: "infinity" }, { kind: "negative-infinity" }
];
test("Drive original PG take/collation observation gate (review required, not product parity)", {
  skip: optIn === undefined, timeout: 200_000
}, async suite => {
  assert.equal(optIn, "postgresql://synthetic@127.0.0.1:56750/drive_history_test");
  assert.ok(process.env.PG_DRIVE_HISTORY_TEST_DATA_DIRECTORY, "coordinator must pass actual owned PG data_directory");
  const manifest = verifyClosure();
  suite.diagnostic(`baseline=${manifest.baseline}; frozen files=${manifest.files.length}; page frozen only, not executed`);
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "PG_DRIVE_HISTORY_TEST_DATABASE_URL", "PG_DRIVE_HISTORY_TEST_DATA_DIRECTORY"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  const worker = fork(new URL("../../../.claude/plans/mongodb-drive-import-history/original/pg-gate-worker.fixture.ts", import.meta.url), [JSON.stringify(tags)], {
    env: { ...env, LC_ALL: "C", NODE_ENV: "test" },
    execArgv: ["--experimental-strip-types", "--experimental-loader", new URL("../../../scripts/ts-loader.mjs", import.meta.url).pathname],
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let result = false, cleanup = false, failure: string | undefined, stdout = "", stderr = "";
  let takeCases = 0, collation = false, collationOrder = false, negativeTies = 0;
  worker.stdout?.on("data", value => { stdout += String(value); });
  worker.stderr?.on("data", value => { stderr += String(value); });
  worker.on("message", value => {
    const message = value as { kind: string; phase?: string; status?: string; message?: string; ownedRuns?: number; ownedResults?: number };
    suite.diagnostic(JSON.stringify(message));
    if (message.kind === "result") result = message.status === "ORIGINAL_OBSERVATIONS_ONLY_REVIEW_REQUIRED";
    if (message.kind === "cleanup") cleanup = message.ownedRuns === 0 && message.ownedResults === 0;
    if (message.kind === "failure") failure = message.message;
    if (message.phase === "take") takeCases++;
    if (message.phase === "collation") collation = true;
    if (message.phase === "collation-order") collationOrder = true;
    if (message.phase === "negative-tie") negativeTies++;
  });
  await new Promise<void>((resolve, reject) => {
    let timedOut = false, childError: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true; worker.kill("SIGTERM");
      escalation = setTimeout(() => { worker.kill("SIGKILL"); }, 5_000);
    }, 180_000);
    worker.on("error", error => {
      childError = error;
      if (worker.pid === undefined && !timedOut) { clearTimeout(timer); reject(error); }
    });
    worker.once("exit", (code, signal) => {
      clearTimeout(timer); clearTimeout(escalation);
      if (timedOut) reject(new Error(`Drive gate timeout; observed exit=${code}/${signal}, pid=${worker.pid}. STOP workers. OWNED RESOURCE AUDIT REQUIRED; cleanup NOT confirmed.\n${stdout}\n${stderr}`));
      else if (code !== 0 || signal || childError || failure || !result || !cleanup) reject(new Error(`Drive gate exit=${code}/${signal}; result=${result}; cleanup=${cleanup}; ${childError?.message ?? ""}\n${failure ?? ""}\n${stdout}\n${stderr}`));
      else resolve();
    });
  });
  assert.equal(takeCases, tags.length); assert.ok(collation && collationOrder); assert.equal(negativeTies, 3);
  suite.diagnostic("Observation collection complete. Coordinator must review actual negative/malformed take and effective synthetic collation before product implementation. No production collation, current/native/page equivalence claimed.");
});

// Separate opt-in keeps the prior original-only gate command stable.
const parityOptIn = process.env.DRIVE_HISTORY_PARITY === "1";
test("Drive independent literal parity: closure controls, original PG, current PG, explicit native", {
  skip: !parityOptIn, concurrency: false, timeout: 1_150_000
}, async suite => {
  assert.equal(optIn, "postgresql://synthetic@127.0.0.1:56750/drive_history_test");
  assert.equal(process.env.MONGODB_DRIVE_HISTORY_TEST_URI, "mongodb://127.0.0.1:27850/?replicaSet=drivehistory20260930");
  verifyClosure();
  const run = async (file: string, args: string[], requireCleanup: boolean) => {
    const env = Object.fromEntries(["PATH","HOME","TMPDIR","PG_DRIVE_HISTORY_TEST_DATABASE_URL","PG_DRIVE_HISTORY_TEST_DATA_DIRECTORY","MONGODB_DRIVE_HISTORY_TEST_URI"].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]!]]));
    const worker = fork(new URL(`../../../.claude/plans/mongodb-drive-import-history/original/${file}`,import.meta.url),args,{
      env:{...env,LC_ALL:"C",NODE_ENV:"test"},execArgv:["--experimental-strip-types","--experimental-loader",new URL("../../../scripts/ts-loader.mjs",import.meta.url).pathname],stdio:["ignore","pipe","pipe","ipc"]
    });
    let result: {ledger?: Array<{name:string;value:unknown}>} | undefined, cleanup=false, failure:string|undefined, stdout="",stderr="";
    worker.stdout?.on("data",value=>{stdout+=String(value);});worker.stderr?.on("data",value=>{stderr+=String(value);});
    worker.on("message",value=>{
      const message=value as {kind:string;message?:string;ledger?:Array<{name:string;value:unknown}>};
      if(message.kind==="result")result=message;
      else if(message.kind==="cleanup")cleanup=true;
      else if(message.kind==="failure")failure=message.message;
      // Full literal assertions happen inside each worker; final ledger is preserved once below.
      if(message.kind!=="result")suite.diagnostic(JSON.stringify(message));
    });
    await new Promise<void>((resolve,reject)=>{
      let timedOut=false,childError:Error|undefined;let escalation:ReturnType<typeof setTimeout>|undefined;
      const timer=setTimeout(()=>{timedOut=true;worker.kill("SIGTERM");escalation=setTimeout(()=>{worker.kill("SIGKILL");},5000);},180_000);
      worker.on("error",error=>{childError=error;if(worker.pid===undefined&&!timedOut){clearTimeout(timer);reject(error);}});
      worker.once("exit",(code,signal)=>{
        clearTimeout(timer);clearTimeout(escalation);
        if(timedOut)reject(new Error(`${file} timeout; observed exit=${code}/${signal}; pid=${worker.pid}; STOP all further workers; OWNED RESOURCE AUDIT REQUIRED, cleanup NOT confirmed.\n${stdout}\n${stderr}`));
        else if(code!==0||signal||childError||failure||!result||(requireCleanup&&!cleanup))reject(new Error(`${file} ${args.join(",")} exit=${code}/${signal}; cleanup=${cleanup}\n${childError?.message??""}\n${failure??""}\n${stdout}\n${stderr}`));
        else resolve();
      });
    });
    assert.ok(result);return result;
  };
  // Await directly: any timeout/failure throws out of this suite and starts no next worker.
  for(const mode of ["frozen-byte","actual-loader-byte","undeclared-current-import"])await run("closure-negative-worker.fixture.ts",[mode],false);
  let original: Array<{name:string;value:unknown}> | undefined;
  for(const backend of ["original","current","mongo"]){
    const result=await run("parity-worker.fixture.ts",[backend],true);
    assert.ok(result.ledger && result.ledger.length>30);
    assert.ok(result.ledger.some(row=>row.name==="selected-finishedAt-nonnull-whole-DTO"));
    if(backend!=="mongo")for(const delegate of ["driveImportRun","driveImportResult"]){
      assert.ok(result.ledger.some(row=>row.name===`default-dto-conversion-injection-${delegate}-null`));
    }
    if(backend==="original")original=result.ledger;
    else if(backend==="current")assert.deepEqual(result.ledger,original,"full PG ledger differs from frozen original");
    else assert.deepEqual(result.ledger,original!.filter(row=>!row.name.startsWith("default-")),"normal native ledger differs from frozen original");
    suite.diagnostic(JSON.stringify({backend,ledger:result.ledger}));
  }
  suite.diagnostic("Closure controls and independent literal parity completed. Page/parent/crypto/budget suites have separate owners; no evidence for those is claimed here.");
});
