/** Supervisor per backend/TZ. Actual DB operations are performed only when parent opts in. */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {ROOT as REPO,hash,verifyOriginal} from '../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts';
import {ParityStore,type Backend} from './driveImportWriterParityStore.fixture.ts';
import {ROOT,scenarios,expected,assertLedger,assertIds,negativeControls,idNegativeControls,assertObservation,observationNegatives,sqlShapeNegatives,canonical,type Scenario,type Row} from './driveImportWriterParityLiterals.fixture.ts';
import {PriorTuples,reviewNegatives,outputNegatives,publicLogNegatives,assertRuntimeStderr,stderrDiagnostic} from './driveImportWriterParityReview.fixture.ts';
const backend=process.argv[2] as Backend,tz=process.argv[3];
const ledger:Array<{scenario:string;tuple:unknown}>=[];
let retained=false,activeScenario="bootstrap";
async function send(value:unknown){if(process.send)await new Promise<void>((resolve,reject)=>process.send!(value,e=>e?reject(e):resolve()));}
async function child(scenario:Scenario,store:ParityStore){
 const cwd=mkdtempSync(`${ROOT}/parity-child-`);
 const env:NodeJS.ProcessEnv={NODE_ENV:'test',LC_ALL:'C',TZ:tz,PATH:process.env.PATH,HOME:process.env.HOME,PGOPTIONS:'-c timezone=UTC -c statement_timeout=15000',PGAPPNAME:'synthetic-drive-parity',PII_ACTIVE_KEY_ID:process.env.PII_ACTIVE_KEY_ID,PII_ENCRYPTION_KEYS:process.env.PII_ENCRYPTION_KEYS,PII_INDEX_KEY:process.env.PII_INDEX_KEY,PII_ALLOW_PLAINTEXT_READS:'false'};
 if(backend!=='mongo')env.DATABASE_URL=`postgresql://synthetic@127.0.0.1:56753/${store.databaseName}`;
 const worker=fork(new URL('./driveImportWriterParityChild.fixture.ts',import.meta.url),[backend,scenario,store.databaseName],{cwd,env,execArgv:['--experimental-strip-types','--experimental-loader',`${REPO}scripts/ts-loader.mjs`],stdio:['ignore','pipe','pipe','ipc']});
 const stderr:Buffer[]=[],stdout:Buffer[]=[];worker.stderr?.on('data',b=>stderr.push(Buffer.from(b)));worker.stdout?.on('data',b=>stdout.push(Buffer.from(b)));
 const exit=await new Promise<number|null>((resolve,reject)=>{let timeout=false,kill:ReturnType<typeof setTimeout>|undefined;const timer=setTimeout(()=>{timeout=true;worker.kill('SIGTERM');kill=setTimeout(()=>worker.kill('SIGKILL'),5000);},60000);worker.once('error',()=>{if(worker.pid===undefined){clearTimeout(timer);reject(new Error('PARITY_CHILD_SPAWN_FAILED'));}});worker.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(kill);if(timeout||signal){retained=true;reject(new Error('CHILD_OBSERVED_EXIT_AFTER_TIMEOUT_OR_SIGNAL; STOP; OWNED_RESOURCE_AUDIT_REQUIRED; CLEANUP_UNCONFIRMED'));}else resolve(code);});});
 assert.equal(Buffer.concat(stdout).length,0,'RAW_CHILD_STDOUT');
 if(backend!=='legacy')try{assertRuntimeStderr(Buffer.concat(stderr).toString('utf8'),REPO,[process.env.PII_ENCRYPTION_KEYS!,process.env.PII_INDEX_KEY!,...Object.values(JSON.parse(process.env.PII_ENCRYPTION_KEYS!) as Record<string,string>)]);}catch{
  const diagnostic=stderrDiagnostic(Buffer.concat(stderr).toString('utf8')),path=`${cwd}/stderr-diagnostic.json`;writeFileSync(path,JSON.stringify(diagnostic,null,2));await send({kind:'output-diagnostic',backend,tz,scenario,path,diagnostic});throw new Error('PARITY_STDERR_REJECTED');
 }
 const report=JSON.parse(readFileSync(`${cwd}/observer.json`,'utf8')) as {events:Row[];sources:Row[];violations:string[];progress:string[];fetches:number;result?:Row;failure?:string;maxActive:number};
 assert.notEqual(report.failure,'BOOTSTRAP_FAILURE',`CHILD_BOOTSTRAP_${backend}_${scenario}`);
 assertObservation(report);
 await send({kind:'observation',backend,tz,scenario,path:`${cwd}/observer.json`,exit,stderrHash:hash(Buffer.concat(stderr)),stderrBytes:Buffer.concat(stderr).length});
 return {exit,report};
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function timestamp(v:unknown,before:number,after:number){assert.ok(v instanceof Date&&Number.isFinite(v.getTime()));assert.ok(v.getTime()>=before-2&&v.getTime()<=after+2,'TIME_OUTSIDE_CALL');return '<time>';}
function normalizedRun(row:Row,before:number,after:number):Row{assert.match(String(row.id),uuid);return {...row,id:'<run>',startedAt:timestamp(row.startedAt,before,after),finishedAt:row.finishedAt===null?null:timestamp(row.finishedAt,before,after)};}
function normalizedRows(rows:Row[],runId:string,before:number,after:number):Row[]{return rows.map((row):Row=>{assert.match(String(row.id),uuid);assert.equal(row.runId,runId);return {...row,id:'<result>',runId:'<run>',startDate:row.startDate===null?null:(row.startDate as Date).toISOString().slice(0,10),endDate:row.endDate===null?null:(row.endDate as Date).toISOString().slice(0,10),createdAt:timestamp(row.createdAt,before,after)};}).sort((a,b)=>String(a.operationId).localeCompare(String(b.operationId))||(a.resultKind==='error'?1:0)-(b.resultKind==='error'?1:0));}
function runDTO(run:Row,rows:Row[]){return {avgSatisfactionCandidateCount:run.avgSatisfactionCandidateCount,errorCount:run.errorCount,finishedAt:run.finishedAt??'',folderSearchCount:run.folderSearchCount,folderSearchWithCandidatesCount:run.folderSearchWithCandidatesCount,id:run.id,instructorCandidateCount:run.instructorCandidateCount,instructorSatisfactionCandidateCount:run.instructorSatisfactionCandidateCount,mode:run.mode,operationCount:run.operationCount,results:[...rows].sort((a,b)=>Number(b.candidateCount)-Number(a.candidateCount)).map(r=>({candidateCount:r.candidateCount,companyName:r.companyName,courseName:r.courseName,createdAt:r.createdAt,endDate:r.endDate??'',error:r.error??'',fileCount:r.fileCount,folderCandidates:r.folderCandidates,folderTitle:r.folderTitle??'',folderUrl:r.folderUrl??'',inputKind:r.inputKind,inputValue:r.inputValue??'',issues:r.issues,keyCandidates:r.keyCandidates,operationId:r.operationId,resultKind:r.resultKind,startDate:r.startDate??''})),scanFoundFolderCount:run.scanFoundFolderCount,scanIssueCount:run.scanIssueCount,scannedRefCount:run.scannedRefCount,startedAt:run.startedAt,status:run.status,suspiciousCandidateCount:run.suspiciousCandidateCount};}
function resultDTO(run:Row,r:Row){return {candidateCount:r.candidateCount,createdAt:r.createdAt,fileCount:r.fileCount,folderCandidates:r.folderCandidates,folderTitle:r.folderTitle??'',folderUrl:r.folderUrl??'',inputKind:r.inputKind,inputValue:r.inputValue??'',issues:r.issues,keyCandidates:r.keyCandidates,resultKind:r.resultKind,runId:run.id,runStartedAt:run.startedAt,runStatus:run.status};}
async function checkHistory(store:ParityStore,want:ReturnType<typeof expected>,run:Row,rows:Row[]){
 if(!store.history||!want.run)return;
 const literal={...want.run,id:run.id,startedAt:(run.startedAt as Date).toISOString(),finishedAt:run.finishedAt===null?null:(run.finishedAt as Date).toISOString()};
 const ordered=[...rows].sort((a,b)=>String(a.operationId).localeCompare(String(b.operationId))||(a.resultKind==='error'?1:0)-(b.resultKind==='error'?1:0));
 const literals=want.rows.map((row,i)=>({...row,id:ordered[i].id,runId:run.id,createdAt:(ordered[i].createdAt as Date).toISOString()}));
 assert.deepEqual(await store.history.readLatestDriveImportRun(),runDTO(literal,literals),'EXISTING_HISTORY_RUN_FULL_DTO');
 for(const operationId of new Set(rows.map(r=>String(r.operationId)))){
  const candidates=rows.filter(r=>r.operationId===operationId);const max=Math.max(...candidates.map(r=>(r.createdAt as Date).getTime()));
  const allowed=candidates.filter(r=>(r.createdAt as Date).getTime()===max).map(r=>resultDTO(literal,literals[ordered.findIndex(row=>row.id===r.id)]));
  const got=await store.history.readLatestDriveImportResult(operationId);assert.ok(allowed.some(row=>canonical(row)===canonical(got)),'EXISTING_HISTORY_RESULT_FULL_DTO');
 }
}
async function main(){
 if(process.argv[2]==='output-probe'){assert.equal(process.env.DRIVE_IMPORT_WRITER_OUTPUT_PROBE,'1');return;} // Imports/runtime warnings only: before keys, store construction or DB IO.
 assert.ok(['legacy','current','mongo'].includes(backend));assert.ok(tz==='UTC'||tz==='Asia/Seoul');assert.equal(process.env.TZ,'UTC');
 for(const key of ['DATABASE_URL','DIRECT_URL','PII_ENCRYPTION_KEYS','PII_INDEX_KEY'])assert.equal(process.env[key],undefined);
 verifyOriginal();reviewNegatives();outputNegatives();publicLogNegatives();negativeControls();idNegativeControls();observationNegatives();sqlShapeNegatives();mkdirSync(ROOT,{recursive:true});
 Object.assign(process.env,{PII_ACTIVE_KEY_ID:'driveparity',PII_ENCRYPTION_KEYS:JSON.stringify({driveparity:randomBytes(32).toString('base64')}),PII_INDEX_KEY:randomBytes(32).toString('base64'),PII_ALLOW_PLAINTEXT_READS:'false'});
 globalThis.fetch=async()=>{throw new Error('EXTERNAL_FETCH_FORBIDDEN');};
 const prior=new PriorTuples();
 const store=new ParityStore(backend),runIds=new Set<string>(),rowIds=new Set<string>();
 try{
  await store.open();
  for(const scenario of scenarios){
   activeScenario=scenario;
   if(scenario==='empty')await store.emptySelection(true);
   const invariant=await store.invariant(),before=Date.now();
   const {exit,report}=await child(scenario,store),after=Date.now(),want=expected(scenario,tz);
   assert.equal(exit,want.exit,`${backend}/${tz}/${scenario} EXIT`);assert.equal(report.sources.length,want.sourceCalls,`${scenario} SOURCE_COUNT`);
   if(scenario.startsWith('parallel-'))assert.equal(report.maxActive,2);
   if(want.normal)assert.deepEqual(report.sources.map(s=>s.method),['scan','scan','search']);
   const events=report.events.filter(e=>e.kind==='createRun'&&e.phase==='committed-or-read');
   assert.equal(events.length,want.run?1:0);
   const id=events[0]?.runId as string|undefined;
   const allRuns=await store.read('DriveImportRun'),allRows=await store.read('DriveImportResult');
   const snapshot={rawRuns:await store.raw('DriveImportRun'),rawRows:await store.raw('DriveImportResult'),runs:allRuns,rows:allRows};
   prior.assertPreserved(snapshot);
   const runs=id?allRuns.filter(r=>r.id===id):[],rows=id?allRows.filter(r=>r.runId===id):[];
   assert.equal(runs.length,want.run?1:0);
   const tuple={run:runs.length?normalizedRun(runs[0],before,after):null,rows:id?normalizedRows(rows,id,before,after):[]};
   assertLedger(tuple,{run:want.run,rows:want.rows});
   if(id){assert.ok(!runIds.has(id));runIds.add(id);for(const row of rows){assert.ok(!rowIds.has(String(row.id)));rowIds.add(String(row.id));}await checkHistory(store,want,runs[0],rows);prior.rememberVerified(snapshot,id,rows.map(row=>String(row.id)));}
   prior.assertComplete(snapshot);
   assertIds(allRuns,runIds);assertIds(allRows,rowIds);
   assert.deepEqual(await store.invariant(),invariant,'BUSINESS_RAW_OR_ACTIVITY_CHANGED');
   if(exit===0){assert.deepEqual(report.result,{runId:id,status:want.run!.status==='COMPLETED_WITH_ERRORS'?'completed_with_errors':'completed',summary:want.run!.summary});}
   else assert.equal(report.result,undefined);
   if(['load-before','limit-bigint-overflow','create-before','create-after','pick-before-try','empty','zero-workers'].includes(scenario))assert.deepEqual(report.progress,[]);
   else assert.deepEqual(report.progress,[`[drive-import-dry-run] ${want.normal?3:1}/${want.normal?3:1}`]);
   if(scenario==='append-after')assert.equal(report.events.filter(e=>e.kind==='appendResult'&&e.phase==='committed-or-read').length,2);
   if(scenario==='catch-append-failure'||scenario==='source-stringification-error')assert.equal(report.events.filter(e=>e.kind==='finishRun').length,0);
   if(scenario==='source-stringification-error')assert.equal(report.events.filter(e=>e.kind==='appendResult').length,0);
   ledger.push({scenario,tuple});await send({kind:'case',backend,tz,scenario});
   if(scenario==='empty')await store.emptySelection(false);
  }
  // Final recovery has completed. Expectations were accumulated only after independent tuple checks.
  assertIds(await store.read('DriveImportRun'),runIds);assertIds(await store.read('DriveImportResult'),rowIds);
  prior.assertComplete({rawRuns:await store.raw('DriveImportRun'),rawRows:await store.raw('DriveImportResult'),runs:await store.read('DriveImportRun'),rows:await store.read('DriveImportResult')});
  const path=`${ROOT}/parity-${backend}-${tz.replace('/','-')}.json`;writeFileSync(path,JSON.stringify({backend,tz,sourceSeam:'synthetic-port-not-actualHTTP',ledger},null,2));
  await send({kind:'ledger',backend,tz,path,ledger});
 }finally{await store.close(retained);await send({kind:'cleanup',backend,tz,retained,remaining:retained?'UNCONFIRMED':0});}
}
main().then(()=>process.disconnect?.(),async()=>{await send({kind:'failure',backend,tz,code:'PARITY_CHECK_FAILED',scenario:activeScenario,retained});process.exitCode=1;process.disconnect?.();});
