/** Review regressions: immutable prior tuples, NULL storage, and non-leaking output checks. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonical,summary,type Row} from './driveImportWriterParityLiterals.fixture.ts';
export type Snapshot = {rawRuns:Row[];rawRows:Row[];runs:Row[];rows:Row[]};
const identity=(row:Row)=>String(row.id??row._id);
export class PriorTuples {
 private readonly expected = new Map<keyof Snapshot,Map<string,string>>();
 constructor(){for(const name of ['rawRuns','rawRows','runs','rows'] as const)this.expected.set(name,new Map());}
 assertPreserved(actual:Snapshot){
  for(const [name,saved] of this.expected){
   const rows=actual[name];assert.equal(new Set(rows.map(identity)).size,rows.length,'SNAPSHOT_DUPLICATE_ID');
   const found=new Map(rows.map(row=>[identity(row),canonical(row)]));
   for(const [id,value] of saved)assert.ok(found.get(id)===value,`PRIOR_TUPLE_CHANGED_${name}`);
  }
 }
 rememberVerified(actual:Snapshot,runId:string,rowIds:string[]){
  for(const [name,saved] of this.expected){
   const ids=name==='rawRuns'||name==='runs'?[runId]:rowIds;
   for(const id of ids){assert.ok(!saved.has(id),'SNAPSHOT_ALREADY_REGISTERED');const rows=actual[name].filter(row=>identity(row)===id);assert.equal(rows.length,1);saved.set(id,canonical(rows[0]));}
  }
 }
 assertComplete(actual:Snapshot){this.assertPreserved(actual);for(const [name,saved] of this.expected)assert.equal(actual[name].length,saved.size,'SNAPSHOT_EXTRA_TUPLE');}
}
export function assertPendingSummary(raw:unknown,sqlIsNull?:boolean){assert.ok(raw===null,'PENDING_SUMMARY_NOT_STORAGE_NULL');if(sqlIsNull!==undefined)assert.ok(sqlIsNull===true,'PENDING_SUMMARY_SQL_JSON_NULL');}
export function reviewNegatives(){
 const good:Snapshot={rawRuns:[{id:'run',summary:null}],runs:[{id:'run',summary:null}],rawRows:[{id:'row',runId:'run',payload:'cipher'}],rows:[{id:'row',runId:'run',error:null}]};
 const check=new PriorTuples();check.rememberVerified(good,'run',['row']);check.assertComplete(structuredClone(good));
 for(const key of ['rawRuns','runs','rawRows','rows'] as const){const bad=structuredClone(good);bad[key][0].sameIdMutation='changed';assert.throws(()=>check.assertComplete(bad));}
 assertPendingSummary(null,true);for(const raw of [{$jsonNull:true},{$json:null},{__pii:'synthetic'},undefined])assert.throws(()=>assertPendingSummary(raw));assert.throws(()=>assertPendingSummary(null,false));
}
const forbidden=['SYNTHETIC_STRINGIFICATION_ERROR','SYNTHETIC_SOURCE_ERROR','SYNTHETIC_NONERROR','SYNTHETIC_DELEGATION_FAULT','SYNTHETIC_OM','SYNTHETIC_COMPANY','SYNTHETIC_TITLE','SYNTHETIC_ISSUE','https://synthetic.invalid/','Cannot read properties of null'];
export function assertNoPrivateOutput(value:string,secrets:readonly string[]=[]){assert.ok(![...forbidden,...secrets.filter(Boolean)].some(item=>value.includes(item)),'PRIVATE_OUTPUT_REJECTED');}
export function assertErrorOutput(args:unknown[],secrets:readonly string[]=[]){
 // Workflow should be silent. Only a single exact public code string is additionally allowed.
 // Error objects (message/cause/stack), additional arguments and arbitrary objects fail closed.
 assert.ok(args.length===1&&args[0]==='DRIVE_IMPORT_WRITER_FAILED','NON_PUBLIC_CONSOLE_ERROR');
 assertNoPrivateOutput(String(args[0]),secrets);
}
export function assertRuntimeStderr(value:string,repo:string,secrets:readonly string[]=[]){
 assertNoPrivateOutput(value,secrets);
 const register=`register(${JSON.stringify(repo+'scripts/ts-loader.mjs')}, pathToFileURL("./"));`;
 const importPrefix=`--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; `;
 const allowed=new Set([
  'ExperimentalWarning: `--experimental-loader` may be removed in the future; instead use `register()`:',
  'ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time',
  importPrefix+register+"'",importPrefix+register+' '+register+"'",
  '(Use `node --trace-warnings ...` to show where the warning was created)',
  'Reparsing as ES module because module syntax was detected. This incurs a performance overhead.',
  `To eliminate this warning, add "type": "module" to ${repo}package.json.`
 ]);
 for(const file of ['src/lib/data/driveImportWriterParityChild.fixture.ts','src/lib/data/driveImportWriterParityWorker.fixture.ts','.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts'])allowed.add(`[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file://${repo}${file} is not specified and it doesn't parse as CommonJS.`);
 for(const line of value.split('\n'))assert.ok(line===''||allowed.has(line.replace(/^\(node:\d+\) /,'')),'UNAPPROVED_STDERR_LINE');
}
export function outputNegatives(){
 assertErrorOutput(['DRIVE_IMPORT_WRITER_FAILED']);assertRuntimeStderr('','/synthetic/');
 for(const args of [['SYNTHETIC_SOURCE_ERROR'],[new Error('SYNTHETIC_SOURCE_ERROR')],['DRIVE_IMPORT_WRITER_FAILED','SYNTHETIC_OM'],[{message:'DRIVE_IMPORT_WRITER_FAILED',cause:'SYNTHETIC_NONERROR'}]])assert.throws(()=>assertErrorOutput(args));
 for(const text of ['SYNTHETIC_SOURCE_ERROR','unknown driver error','DRIVE_IMPORT_WRITER_FAILED\nSYNTHETIC_OM','SYNTHETIC_TEMP_KEY'])assert.throws(()=>assertRuntimeStderr(text,'/synthetic/',['SYNTHETIC_TEMP_KEY']));
}

export function assertPublicLog(args:unknown[],secrets:readonly string[]=[]):string|Row{
 assert.ok(args.length===1&&typeof args[0]==='string','UNAPPROVED_CONSOLE_LOG');
 const value=args[0] as string;assertNoPrivateOutput(value,secrets);
 if(/^\[drive-import-dry-run\] \d+\/\d+$/.test(value))return value;
 let parsed:Row;try{parsed=JSON.parse(value) as Row;}catch{throw new Error('UNAPPROVED_CONSOLE_JSON');}
 assert.ok(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'UNAPPROVED_CONSOLE_OBJECT');
 assert.ok(canonical(Object.keys(parsed).sort())===canonical(['runId','status','summary']),'UNAPPROVED_CONSOLE_FIELDS');
 assert.ok(typeof parsed.runId==='string'&&/^[a-f0-9-]{36}$/.test(parsed.runId),'UNAPPROVED_CONSOLE_ID');
 assert.ok(parsed.status==='completed'||parsed.status==='completed_with_errors','UNAPPROVED_CONSOLE_STATUS');
 const counts=parsed.summary as Row,shape=summary('zero');
 assert.ok(counts&&typeof counts==='object'&&canonical(Object.keys(counts).sort())===canonical(Object.keys(shape).sort()),'UNAPPROVED_SUMMARY_FIELDS');
 for(const [key,value] of Object.entries(counts)){
  if(key==='suspicious'){assert.ok(value&&typeof value==='object'&&canonical(Object.keys(value).sort())===canonical(['badInstructorFragments','clockInstructorCandidates','zeroSatisfactionCandidates']),'UNAPPROVED_SUSPICIOUS_FIELDS');for(const n of Object.values(value))assert.ok(typeof n==='number'&&Number.isSafeInteger(n)&&n>=0,'UNAPPROVED_COUNT');}
  else assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0,'UNAPPROVED_COUNT');
 }
 return parsed;
}
export function publicLogNegatives(){
 assertPublicLog(['[drive-import-dry-run] 1/1']);
 const good={runId:'00000000-0000-4000-8000-000000000001',status:'completed',summary:summary('zero')};assertPublicLog([JSON.stringify(good)]);
 for(const args of [[JSON.stringify(good),'SYNTHETIC_OM'],[JSON.stringify({...good,extra:'arbitrary raw'})],[JSON.stringify({...good,summary:{...summary('zero'),errors:'private'}})],['SYNTHETIC_SOURCE_ERROR']])assert.throws(()=>assertPublicLog(args));
}

/** Diagnostic only: classification never grants output permission and includes no captured text. */
export function stderrDiagnostic(value:string){
 const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
 return {code:'STDERR_DIAGNOSTIC_ONLY',bytes:Buffer.byteLength(value),sha256:digest(value),lines:value.split('\n').filter(Boolean).map((line,index)=>{
  const kind=forbidden.some(item=>line.includes(item))?'PRIVATE_CANARY':/^\(node:\d+\) DeprecationWarning: Calling client\.query\(\) when the client is already executing a query is deprecated and will be removed in pg@9\.0\. Use async\/await or an external async flow control mechanism instead\.$/.test(line)?'PG_CONCURRENT_CLIENT_QUERY_WARNING':line.startsWith("--import 'data:text/javascript,")?'NODE_LOADER_REGISTRATION_HINT':/\[MODULE_TYPELESS_PACKAGE_JSON\] Warning:/.test(line)?'NODE_MODULE_TYPE_WARNING':/^\(node:\d+\) ExperimentalWarning:/.test(line)?'NODE_EXPERIMENTAL_WARNING':line==='(Use `node --trace-warnings ...` to show where the warning was created)'?'NODE_TRACE_HINT':line.startsWith('Reparsing as ES module ')?'NODE_REPARSE_HINT':line.startsWith('To eliminate this warning, add "type": "module" to ')?'NODE_PACKAGE_HINT':'UNCLASSIFIED';
  return {line:index+1,kind,bytes:Buffer.byteLength(line),sha256:digest(line),registerCalls:(line.match(/register\(/g)??[]).length,encodedSlash:/%2f/i.test(line),fileUrl:line.includes('file:///'),relativeLoader:line.includes('./scripts/ts-loader.mjs'),absoluteLoader:line.includes('/scripts/ts-loader.mjs'),stripTypesHint:line.includes('stripTypeScriptTypes')};
 })};
}
