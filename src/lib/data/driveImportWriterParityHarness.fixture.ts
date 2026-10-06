/** Parent-only orchestration; no inherited DB/key/source environment. */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {ROOT} from './driveImportWriterParityLiterals.fixture.ts';
import {ROOT as REPO,hash,verifyOriginal} from '../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts';
import type {Diagnostic} from './driveImportWriterGateHarness.fixture.ts';
import {assertRuntimeStderr,stderrDiagnostic} from './driveImportWriterParityReview.fixture.ts';
async function run(t:Diagnostic,backend:string,tz:string){
 const worker=fork(new URL('./driveImportWriterParityWorker.fixture.ts',import.meta.url),[backend,tz],{cwd:REPO,detached:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',LC_ALL:'C',TZ:'UTC'},execArgv:['--experimental-strip-types','--experimental-loader',`${REPO}scripts/ts-loader.mjs`],stdio:['ignore','pipe','pipe','ipc']});
 const stderr:Buffer[]=[],stdout:Buffer[]=[];let ledger:unknown,cleanup=false,failure:unknown;
 worker.stderr?.on('data',b=>stderr.push(Buffer.from(b)));worker.stdout?.on('data',b=>stdout.push(Buffer.from(b)));
 worker.on('message',(message:unknown)=>{const m=message as {kind:string;ledger?:unknown;retained?:boolean;remaining?:number};if(m.kind==='ledger')ledger=m.ledger;if(m.kind==='cleanup')cleanup=m.remaining===0&&!m.retained;if(m.kind==='failure')failure=m;t.diagnostic(JSON.stringify(message));});
 const exit=await new Promise<number|null>((resolve,reject)=>{let timedOut=false,kill:ReturnType<typeof setTimeout>|undefined;const stop=(signal:NodeJS.Signals)=>{if(worker.pid)try{process.kill(-worker.pid,signal);}catch{/* already exited */}};const timer=setTimeout(()=>{timedOut=true;stop('SIGTERM');kill=setTimeout(()=>stop('SIGKILL'),5000);},240000);worker.once('error',()=>{if(worker.pid===undefined){clearTimeout(timer);reject(new Error('PARITY_WORKER_SPAWN_FAILED'));}});worker.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(kill);if(timedOut||signal)reject(new Error('PARITY_WORKER_OBSERVED_EXIT; STOP; OWNED_RESOURCE_AUDIT_REQUIRED; NO_CLEANUP_CLAIM'));else resolve(code);});});
 t.diagnostic(JSON.stringify({kind:'worker-exit',backend,tz,exit,stderrHash:hash(Buffer.concat(stderr)),stderrBytes:Buffer.concat(stderr).length}));
 try{assertRuntimeStderr(Buffer.concat(stderr).toString('utf8'),REPO);}catch{const diagnostic=stderrDiagnostic(Buffer.concat(stderr).toString('utf8')),path=`${ROOT}/parity-stderr-${backend}-${tz.replace('/','-')}.json`;writeFileSync(path,JSON.stringify(diagnostic,null,2));t.diagnostic(JSON.stringify({kind:'output-diagnostic',path,diagnostic}));throw new Error('PARITY_STDERR_REJECTED');}
 assert.equal(Buffer.concat(stdout).length,0);assert.equal(failure,undefined);assert.equal(exit,0);assert.equal(cleanup,true);assert.ok(ledger);return ledger;
}
export async function runFullParity(t:Diagnostic){
 verifyOriginal();
 for(const tz of ['UTC','Asia/Seoul']){
  const original=await run(t,'legacy',tz);
  const current=await run(t,'current',tz);assert.deepEqual(current,original,`${tz} CURRENT_PG_WHOLE_LEDGER`);
  const native=await run(t,'mongo',tz);assert.deepEqual(native,original,`${tz} NATIVE_WHOLE_LEDGER`);
 }
 t.diagnostic('SOURCE_PORT_FIXTURE_PARITY_ONLY; ACTUAL_HTTP_V3_SEPARATE; NO_PRODUCTION_EQUIVALENCE_CLAIM');
}
