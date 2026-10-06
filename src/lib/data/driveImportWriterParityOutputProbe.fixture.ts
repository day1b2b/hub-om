/** Parent-only runtime diagnostic. The worker's output-probe branch returns before all DB/key IO. */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {ROOT as REPO} from '../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts';
import {ROOT} from './driveImportWriterParityLiterals.fixture.ts';
import {assertRuntimeStderr,stderrDiagnostic} from './driveImportWriterParityReview.fixture.ts';
async function main(){
 assert.equal(process.env.DRIVE_IMPORT_WRITER_OUTPUT_PROBE,'1');
 const child=fork(new URL('./driveImportWriterParityWorker.fixture.ts',import.meta.url),['output-probe','UTC'],{cwd:REPO,env:{NODE_ENV:'test',PATH:process.env.PATH,HOME:process.env.HOME,LC_ALL:'C',TZ:'UTC',DRIVE_IMPORT_WRITER_OUTPUT_PROBE:'1'},execArgv:['--experimental-strip-types','--experimental-loader',`${REPO}scripts/ts-loader.mjs`],stdio:['ignore','pipe','pipe','ipc']});
 const stderr:Buffer[]=[],stdout:Buffer[]=[];child.stderr!.on('data',b=>stderr.push(Buffer.from(b)));child.stdout!.on('data',b=>stdout.push(Buffer.from(b)));
 const exit=await new Promise<number|null>((resolve,reject)=>{let expired=false,kill:ReturnType<typeof setTimeout>|undefined;const timer=setTimeout(()=>{expired=true;child.kill('SIGTERM');kill=setTimeout(()=>child.kill('SIGKILL'),5000);},15000);child.once('error',()=>{if(child.pid===undefined){clearTimeout(timer);reject(new Error('OUTPUT_PROBE_SPAWN_FAILED'));}});child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(kill);if(expired||signal)reject(new Error('OUTPUT_PROBE_OBSERVED_TERMINATION'));else resolve(code);});});
 const value=Buffer.concat(stderr).toString('utf8'),diagnostic=stderrDiagnostic(value);let allowed=false;try{assertRuntimeStderr(value,REPO);allowed=true;}catch{/* diagnostic retains strict rejection */}
 mkdirSync(ROOT,{recursive:true});const path=`${ROOT}/parity-output-probe.json`;writeFileSync(path,JSON.stringify({exit,stdoutBytes:Buffer.concat(stdout).length,allowed,diagnostic},null,2));
 console.log(JSON.stringify({code:'OUTPUT_PROBE_FINISHED',path,exit,allowed,diagnostic}));assert.equal(exit,0);assert.equal(Buffer.concat(stdout).length,0);
}
main().catch(()=>{console.error('OUTPUT_PROBE_FAILED');process.exitCode=1;});
