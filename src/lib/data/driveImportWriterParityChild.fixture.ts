/** Actual immutable CLI or current workflow, one process. Labelled source/fault seams only. */
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {MongoClient} from 'mongodb';
import {ROOT as REPO,installOriginalResolver,originalURL} from '../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts';
import {ROOT,MONGO,scanFixture,searchFixture,snapshot,link,fault,classifySQL,type Scenario,type Row} from './driveImportWriterParityLiterals.fixture.ts';
import type {DriveImportWriterRepository} from './driveImportWriterRepository';
import {assertErrorOutput,assertPublicLog} from './driveImportWriterParityReview.fixture.ts';
const [backend,scenarioArg,dbName]=process.argv.slice(2),scenario=scenarioArg as Scenario;
const report:{events:Row[];sources:Row[];progress:string[];violations:string[];result?:unknown;failure?:string;fetches:number;maxActive:number}={events:[],sources:[],progress:[],violations:[],fetches:0,maxActive:0};
const flush=()=>writeFileSync(`${process.cwd()}/observer.json`,JSON.stringify(report));
process.on('exit',flush);
const dataURL=(code:string)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const state=globalThis as unknown as {__driveParityClient:unknown;__driveParitySource:unknown;__driveParityWriter:unknown};
let appendAttempts=0,active=0,arrived=0,releaseArrivals:()=>void=()=>{},releaseFirst:()=>void=()=>{};
const arrival=new Promise<void>(r=>{releaseArrivals=r;}),firstStored=new Promise<void>(r=>{releaseFirst=r;});
const first=scenario==='parallel-reverse'?1:0;
async function source(method:string,input:unknown):Promise<unknown>{
 const i=method==='scan'?input===link(0)?0:1:2;
 report.sources.push({method,input});flush();
 try{assert.deepEqual(input,method==='scan'?link(i):snapshot(2,process.env.TZ!));}
 catch(error){report.violations.push('SOURCE_INPUT_CONTRACT');flush();throw error;}
 active++;report.maxActive=Math.max(active,report.maxActive);flush();
 try{
  if(scenario.startsWith('parallel-')&&i<2){arrived++;if(arrived===2)releaseArrivals();await arrival;if(i!==first)await firstStored;}
  if(scenario==='source-error'||scenario==='catch-append-failure')throw new Error('SYNTHETIC_SOURCE_ERROR');
  if(scenario==='source-nonerror')throw 'SYNTHETIC_NONERROR';
  if(scenario==='source-stringification-error')throw {toString(){throw new Error('SYNTHETIC_STRINGIFICATION_ERROR');}};
  if(scenario==='mapping-error')return {...scanFixture(0),candidates:[null]};
  return method==='scan'?scanFixture(i):searchFixture();
 }finally{active--;flush();}
}
state.__driveParitySource={scan:(v:unknown)=>source('scan',v),search:(v:unknown)=>source('search',v)};
async function observe<T>(kind:string,operation:number|undefined,delegate:()=>Promise<T>):Promise<T>{
 const attempt=kind==='appendResult'?++appendAttempts:1;
 report.events.push({kind,phase:'attempt',attempt,operation});flush();
 if((kind==='loadOperations'&&scenario==='load-before')||(kind==='createRun'&&scenario==='create-before')||(kind==='finishRun'&&scenario==='finish-before')||(kind==='appendResult'&&((scenario==='append-before'&&attempt===1)||scenario==='catch-append-failure')))throw new Error(fault);
 const value=await delegate();report.events.push({kind,phase:'committed-or-read',attempt,operation,...(kind==='createRun'?{runId:value}:{})});flush();
 if(kind==='appendResult'&&operation===first)releaseFirst();
 if((kind==='createRun'&&scenario==='create-after')||(kind==='finishRun'&&scenario==='finish-after')||(kind==='appendResult'&&scenario==='append-after'&&attempt===1))throw new Error(fault);
 return value;
}
globalThis.fetch=async()=>{report.fetches++;report.violations.push('EXTERNAL_FETCH');flush();throw new Error('EXTERNAL_FETCH_FORBIDDEN');};
const outputSecrets=()=>[process.env.PII_ENCRYPTION_KEYS??'',process.env.PII_INDEX_KEY??'',...Object.values(JSON.parse(process.env.PII_ENCRYPTION_KEYS??'{}') as Record<string,string>)];
console.error=(...args:unknown[])=>{
 if(backend==='legacy'){report.failure='EXPECTED_OR_UNEXPECTED_CLI_FAILURE';flush();return;} // Explicit original raw-error exemption; never persist args.
 try{assertErrorOutput(args,outputSecrets());}catch{report.violations.push('PRIVATE_OR_UNAPPROVED_CONSOLE_ERROR');}
 flush();
};
console.log=(...args:unknown[])=>{
 try{const safe=assertPublicLog(args,outputSecrets());if(typeof safe==='string')report.progress.push(safe);else report.result=safe;}
 catch{report.violations.push('PRIVATE_OR_UNAPPROVED_CONSOLE_LOG');}flush();
};
for(const method of ['warn','info','debug'] as const)console[method]=()=>{report.violations.push('UNAPPROVED_CONSOLE_CHANNEL');flush();};

async function main(){
 assert.ok(['legacy','current','mongo'].includes(backend));assert.ok(process.cwd().startsWith(`${ROOT}/parity-child-`));
 assert.equal(existsSync('.env'),false);assert.equal(existsSync('.env.local'),false);
 const normal=['normal','limit-above-safe','limit-1e18','limit-bigint-overflow','parallel-forward','parallel-reverse','recovery','zero-workers'].includes(scenario);
 const verify=(work:()=>void,code:string)=>{try{work();}catch(error){report.violations.push(code);flush();throw error;}};
 const checkOperations=(rows:unknown[])=>verify(()=>assert.deepEqual(rows,Array.from({length:scenario==='empty'?0:normal?3:1},(_,i)=>snapshot(i,process.env.TZ!))),'LOADED_SNAPSHOT');
 const argv=['--mode','synthetic_mode','--concurrency',scenario==='zero-workers'?'0.5':scenario.startsWith('parallel-')?'2':'1',...(!normal&&scenario!=='empty'?['--limit','1']:[])];
 if(scenario==='limit-above-safe')argv.push('--limit','9007199254740992');
 if(scenario==='limit-1e18')argv.push('--limit','1e18');
 if(scenario==='limit-bigint-overflow')argv.push('--limit','9223372036854776000');
 if(backend==='legacy'){
  state.__driveParityClient=function(config:pg.ClientConfig){
   assert.equal(config.connectionString,'postgresql://synthetic@127.0.0.1:56753/drive_writer_legacy');
   const client=new pg.Client(config),query=client.query.bind(client) as (text:string,params?:unknown[])=>Promise<pg.QueryResult>;
   client.query=(async(text:string,params?:unknown[])=>{
    let kind:string;
    try{kind=classifySQL(text);}catch(error){report.violations.push('UNEXPECTED_SQL');flush();throw error;}
    let result:pg.QueryResult|undefined;
    const value=await observe(kind,kind==='appendResult'?Number(String(params?.[2]).split('_').at(-1)):undefined,async()=>{result=await query(text,params);
     if(kind==='guard')verify(()=>assert.equal(result!.rows[0].encrypted,false),'REAL_GUARD_RESULT');
     if(kind==='loadOperations')checkOperations(result.rows.map(row=>({id:row.id,operationId:row.operation_id,companyName:row.company_name??'',courseName:row.course_name??'',startDate:row.start_date?row.start_date.toISOString().slice(0,10):'',endDate:row.end_date?row.end_date.toISOString().slice(0,10):'',om:row.om_name??'',ld:row.ld_name??'',driveLink:row.drive_link??'',lectureManagementLink:row.lecture_management_link??''})));
     return kind==='createRun'?result.rows[0].id:result;});
    if(kind==='createRun'){assert.equal(value,result!.rows[0].id);return result;}
    if(kind==='loadOperations'&&scenario==='pick-before-try')result!.rows[0].drive_link=123; // Explicit post-query type fault, not a DB state.
    return value;
   }) as typeof client.query;return client;
  };
  installOriginalResolver({pgURL:dataURL('export const Client=globalThis.__driveParityClient;'),sourceObserverURL:()=>dataURL('export const scanOperationDriveFolder=globalThis.__driveParitySource.scan;export const searchOperationDriveFolders=globalThis.__driveParitySource.search;')});
  process.argv=[process.execPath,'synthetic-original-cli',...argv];await import(originalURL('scripts/run-drive-import-dry-run.mjs'));return;
 }
 // Current resolver fixes @/ relative to the repository while cwd has no real env files.
 registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@/')){const path=`${REPO}src/${specifier.slice(2)}`;for(const suffix of ['.ts','/index.ts'])if(existsSync(path+suffix))return {url:pathToFileURL(path+suffix).href,shortCircuit:true};}
  if(context.parentURL?.endsWith('/driveImportDryRun.ts')&&specifier==='../data/driveImportSource')return {url:dataURL('export const getDriveImportSource=()=>globalThis.__driveParitySource;'),shortCircuit:true};
  if(backend==='current'&&context.parentURL?.endsWith('/driveImportDryRun.ts')&&specifier==='../data/driveImportWriterFactory')return {url:dataURL('export const getDriveImportWriterRepository=()=>globalThis.__driveParityWriter;'),shortCircuit:true};
  return next(specifier,context);
 }});
 let client:MongoClient|undefined;
 let repo:DriveImportWriterRepository;
 if(backend==='current')repo=new (await import('./prismaDriveImportWriterRepository')).PrismaDriveImportWriterRepository();
 else{assert.equal(process.env.DATABASE_URL,undefined);client=new MongoClient(MONGO,{serverSelectionTimeoutMS:5000});await client.connect();repo=await (await import('./mongoDriveImportWriterRepository')).MongoDriveImportWriterRepository.open({client,databaseName:dbName,namespace:'shadow_drive_parity'});}
 const actual=repo;
 repo={loadOperations:async limit=>{const rows=await observe('loadOperations',undefined,()=>actual.loadOperations(limit));checkOperations(rows);if(scenario==='pick-before-try')(rows[0] as unknown as Row).driveLink=123;return rows;},createRun:(args,count)=>observe('createRun',undefined,()=>actual.createRun(args,count)),appendResult:(run,operation,input,result)=>observe('appendResult',Number(operation.operationId.split('_').at(-1)),()=>actual.appendResult(run,operation,input,result)),finishRun:(run,summary,status)=>observe('finishRun',undefined,()=>actual.finishRun(run,summary,status)),close:()=>actual.close()};
 state.__driveParityWriter=repo;
 try{
  const workflow=await import('../driveImports/driveImportDryRun');
  const invoke=()=>workflow.runDriveImportDryRun(workflow.parseDriveImportArgs(argv),message=>{report.progress.push(message);flush();});
  report.result=backend==='mongo'?await (await import('./dataRepositoryContext')).runWithDataRepositories({driveImportWriter:repo,driveImportSource:state.__driveParitySource as import('./driveImportSource').DriveImportSource},invoke):await invoke();
 }catch{report.failure='CURRENT_WORKFLOW_REJECTED';process.exitCode=1;}
 finally{await repo.close();await client?.close();flush();}
}
main().catch(()=>{report.failure='BOOTSTRAP_FAILURE';flush();process.exitCode=1;});
