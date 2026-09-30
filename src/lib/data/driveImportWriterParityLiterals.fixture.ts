/** Independent literals. Source-port fixtures, NOT actual Google HTTP/scanner evidence. */
import assert from 'node:assert/strict';
export type Row=Record<string,unknown>;
export const ROOT='/private/tmp/hub-om-drive-writer-20260930';
export const MONGO='mongodb://127.0.0.1:27853/?replicaSet=drivewriter20260930';
export const MODELS=['Company','Course','OperationSession','DriveImportRun','DriveImportResult'] as const;
export const TABLES={Company:'companies',Course:'courses',OperationSession:'operation_sessions',DriveImportRun:'drive_import_runs',DriveImportResult:'drive_import_results'};
export const company='41000000-0000-4000-8000-000000000001',course='42000000-0000-4000-8000-000000000001';
export const opId=(i:number)=>`43000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
export const link=(i:number)=>`https://synthetic.invalid/folder/${i}`;
export const scenarios=['normal','limit-above-safe','limit-1e18','limit-bigint-overflow','parallel-forward','parallel-reverse','empty','zero-workers','load-before','create-before','create-after','pick-before-try','source-error','source-nonerror','source-stringification-error','mapping-error','append-before','append-after','catch-append-failure','finish-before','finish-after','recovery'] as const;
export type Scenario=typeof scenarios[number];
export const fault='SYNTHETIC_DELEGATION_FAULT';
export function dates(tz:string){assert.ok(tz==='UTC'||tz==='Asia/Seoul');return tz==='UTC'?['2032-02-03','2032-02-04']:['2032-02-02','2032-02-03'];}
export function snapshot(i:number,tz:string){const [startDate,endDate]=dates(tz);return {id:opId(i),operationId:`SYNTHETIC_OP_${i}`,companyName:'SYNTHETIC_COMPANY',courseName:'SYNTHETIC_COURSE',startDate,endDate,om:'SYNTHETIC_OM',ld:'',driveLink:i===0?` ${link(0)} `:i===1?' ': '',lectureManagementLink:i===0?'SYNTHETIC_IGNORED':i===1?` ${link(1)} `:''};}
export const expectedKeys=[
 {confidence:'high',evidence:'',field:'driveLink',label:'d',sourceTitle:'s',value:'D'},
 {evidence:'',field:'lectureManagementLink',label:'l',sourceTitle:'s',value:'L'},
 {confidence:null,evidence:'e',field:'resultReportLink',label:'r',sourceTitle:'s',value:'R'},
 {confidence:'high',evidence:'',field:'avgSatisfaction',label:'a',sourceTitle:'s',value:'0.00'},
 {confidence:'high',evidence:'',field:'instructorSatisfaction',label:'b',sourceTitle:'s',value:'0.00'},
 {confidence:'high',evidence:'',field:'instructors',label:'c',sourceTitle:'s',value:'시계'},
 {confidence:'high',evidence:'',field:'instructors',label:'c',sourceTitle:'s',value:'등에서도'},
 {confidence:'high',evidence:'',field:'instructors',label:'c',sourceTitle:'s',value:'시계'},
];
export function scanFixture(i:number):Row {return i===0?{folderId:'SYNTHETIC_FOLDER',folderTitle:'SYNTHETIC_TITLE',folderUrl:link(0),files:[{id:'f1'},{id:'f2'}],issues:['SYNTHETIC_ISSUE_A','SYNTHETIC_ISSUE_B'],candidates:[
 {confidence:'high',evidence:null,field:'driveLink',label:'d',sourceTitle:'s',value:'D',id:'DROP'},
 {field:'lectureManagementLink',label:'l',sourceTitle:'s',value:'L',sourceUrl:'DROP'},
 {confidence:null,evidence:'e',field:'resultReportLink',label:'r',sourceTitle:'s',value:'R'},
 {confidence:'high',field:'avgSatisfaction',label:'a',sourceTitle:'s',value:'0.00'},
 {confidence:'high',field:'instructorSatisfaction',label:'b',sourceTitle:'s',value:'0.00'},
 {confidence:'high',field:'instructors',label:'c',sourceTitle:'s',value:'시계'},
 {confidence:'high',field:'instructors',label:'c',sourceTitle:'s',value:'등에서도'},
 {confidence:'high',field:'instructors',label:'c',sourceTitle:'s',value:'시계'},
 {field:'SYNTHETIC_EXCLUDED',value:'DROP'}]}:{folderId:'',folderTitle:'',folderUrl:'',files:[],issues:[],candidates:[]};}
export const expectedFolders=Array.from({length:10},(_,i)=>({confidence:'high',reasons:[`reason-${i}`],score:100-i,title:`SYNTHETIC_TITLE_${i}`,url:link(10+i)}));
export function searchFixture():Row {return {candidates:Array.from({length:11},(_,i)=>({confidence:'high',reasons:[`reason-${i}`],score:100-i,title:`SYNTHETIC_TITLE_${i}`,url:link(10+i),id:`DROP_${i}`})),issues:[]};}
export function summary(kind:'zero'|'scan'|'normal',errors=0):Row{return {avgSatisfactionCandidates:kind==='zero'?0:1,errors,folderSearches:kind==='normal'?1:0,folderSearchWithCandidates:kind==='normal'?1:0,instructorCandidates:kind==='zero'?0:3,instructorSatisfactionCandidates:kind==='zero'?0:1,scanFoundFolder:kind==='zero'?0:1,scanIssues:kind==='zero'?0:1,scannedRefs:kind==='normal'?2:kind==='scan'?1:0,suspicious:{badInstructorFragments:kind==='zero'?0:1,clockInstructorCandidates:kind==='zero'?0:2,zeroSatisfactionCandidates:kind==='zero'?0:2},suspiciousCandidateCount:kind==='zero'?0:5};}
const zeroCounts={scannedRefCount:0,scanFoundFolderCount:0,scanIssueCount:0,folderSearchCount:0,folderSearchWithCandidatesCount:0,avgSatisfactionCandidateCount:0,instructorSatisfactionCandidateCount:0,instructorCandidateCount:0,suspiciousCandidateCount:0,errorCount:0};
const richCounts={scannedRefCount:1,scanFoundFolderCount:1,scanIssueCount:1,folderSearchCount:0,folderSearchWithCandidatesCount:0,avgSatisfactionCandidateCount:1,instructorSatisfactionCandidateCount:1,instructorCandidateCount:3,suspiciousCandidateCount:5,errorCount:0};
export function expected(s:Scenario,tz:string){
 const normal=['normal','limit-above-safe','limit-1e18','parallel-forward','parallel-reverse','recovery'].includes(s),n=normal||s==='zero-workers'?3:s==='empty'?0:1;
 const noRun=['load-before','limit-bigint-overflow','create-before'].includes(s),pending=['create-after','pick-before-try','source-stringification-error','catch-append-failure','finish-before'].includes(s);
 const fatal=noRun||pending||s==='finish-after';
 const preSource=['load-before','limit-bigint-overflow','create-before','create-after','pick-before-try','zero-workers','empty'].includes(s);
 const sourceFailure=['source-error','source-nonerror','source-stringification-error','mapping-error','catch-append-failure'].includes(s);
 const errorRow=['source-error','source-nonerror','mapping-error','append-before','append-after'].includes(s);
 const counts=normal?{...richCounts,scannedRefCount:2,folderSearchCount:1,folderSearchWithCandidatesCount:1}:preSource?{...zeroCounts}:sourceFailure?{...zeroCounts,scannedRefCount:1,errorCount:1}:{...richCounts,errorCount:errorRow?1:0};
 let sum=summary(normal?'normal':preSource||sourceFailure?'zero':'scan',errorRow?1:0);if(sourceFailure)sum={...sum,scannedRefs:1};
 const run=noRun?null:{id:'<run>',mode:'synthetic_mode',status:pending?'PENDING':errorRow?'COMPLETED_WITH_ERRORS':'COMPLETED',operationCount:n,...(pending?zeroCounts:counts),summary:pending?null:sum,notes:'Read-only Drive import dry run. Operation data is not modified.',startedAt:'<time>',finishedAt:pending?null:'<time>'};
 const rows:Row[]=[];
 function result(i:number,kind:'scan'|'search'|'error',error:string|null=null){const [startDate,endDate]=dates(tz);return {id:'<result>',runId:'<run>',operationSessionId:opId(i),operationId:`SYNTHETIC_OP_${i}`,companyName:'SYNTHETIC_COMPANY',courseName:'SYNTHETIC_COURSE',startDate,endDate,inputKind:i===0?'driveLink':i===1?'lectureManagementLink':'folderSearch',inputValue:i<2?link(i):'',resultKind:kind==='error'?'error':kind==='search'?'folder_search_candidates':i===0?'scan_found_folder':'scan_no_folder',folderId:kind==='scan'?(i===0?'SYNTHETIC_FOLDER':''):null,folderTitle:kind==='scan'?(i===0?'SYNTHETIC_TITLE':''):null,folderUrl:kind==='scan'?(i===0?link(0):''):null,fileCount:kind==='scan'&&i===0?2:0,candidateCount:kind==='search'?11:kind==='scan'&&i===0?9:0,keyCandidates:kind==='scan'&&i===0?expectedKeys:[],folderCandidates:kind==='search'?expectedFolders:[],issues:kind==='scan'&&i===0?['SYNTHETIC_ISSUE_A','SYNTHETIC_ISSUE_B']:[],error,createdAt:'<time>'};}
 if(normal)rows.push(result(0,'scan'),result(1,'scan'),result(2,'search'));
 else if(!preSource&&!sourceFailure&&s!=='append-before')rows.push(result(0,'scan'));
 if(errorRow)rows.push(result(0,'error',s==='source-nonerror'?'SYNTHETIC_NONERROR':s==='mapping-error'?"Cannot read properties of null (reading 'confidence')":s==='source-error'?'SYNTHETIC_SOURCE_ERROR':fault));
 return {run,rows,exit:fatal?1:0,sourceCalls:preSource?0:normal?3:1,normal};
}
export function canonical(value:unknown):string {if(value instanceof Date)return JSON.stringify(value.toISOString());if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value)??'null';}
export function assertLedger(actual:{run:unknown;rows:unknown[]},want:{run:unknown;rows:unknown[]}){assert.deepEqual(actual.run,want.run);assert.deepEqual(actual.rows,want.rows);}
export function negativeControls(){const want=expected('normal','UTC'),good={run:want.run,rows:want.rows};assertLedger(structuredClone(good),good);const mutations:Array<(x:typeof good)=>void>=[x=>{x.rows.push({...x.rows[0],id:'extra'});},x=>{x.rows.pop();},x=>{x.rows[0].runId='orphan';},x=>{x.rows[0].operationSessionId=opId(9);},x=>{delete x.rows[0].issues;},x=>{x.rows[0].folderTitle=null;},x=>{x.run!.errorCount=1;},x=>{(x.rows[2].folderCandidates as unknown[]).pop();},x=>{(x.rows[2].folderCandidates as unknown[]).push({title:'11th'});},x=>{(x.rows[2].folderCandidates as unknown[])[9]={title:'11th'};}];for(const mutate of mutations){const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertLedger(bad,good));}}
export function assertIds(actual:Row[],ids:Iterable<string>){const expectedIds=[...ids].sort();assert.equal(new Set(actual.map(r=>r.id)).size,actual.length);assert.deepEqual(actual.map(r=>String(r.id)).sort(),expectedIds);}
export function idNegativeControls(){const rows=[{id:'a'},{id:'b'}],ids=['a','b'];assertIds(rows,ids);for(const bad of [[...rows,{id:'c'}],[rows[0]],[{id:'a'},{id:'c'}],[rows[0],rows[0]]])assert.throws(()=>assertIds(bad,ids));}

export function assertObservation(r:{violations:string[];fetches:number}){assert.deepEqual(r.violations,[]);assert.equal(r.fetches,0);}
export function observationNegatives(){assertObservation({violations:[],fetches:0});for(const bad of [{violations:['SOURCE_INPUT_CONTRACT'],fetches:0},{violations:['UNEXPECTED_SQL'],fetches:0},{violations:['LOADED_SNAPSHOT'],fetches:0},{violations:['REAL_GUARD_RESULT'],fetches:0},{violations:[],fetches:1}])assert.throws(()=>assertObservation(bad));}

const sqlShapes={
 guard:"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coaches' AND column_name = 'name_pii_index') AS encrypted",
 loadOperations:"select s.id, s.operation_id, co.name as company_name, c.course_name, s.start_date, s.end_date, s.om_name, s.ld_name, s.drive_link, s.lecture_management_link from operation_sessions s join courses c on c.id = s.course_record_id join companies co on co.id = c.company_id where s.deleted_at is null order by s.start_date asc, s.operation_id asc",
 createRun:"insert into drive_import_runs (mode, status, operation_count, notes) values ($1, 'pending', $2, $3) returning id",
 appendResult:"insert into drive_import_results ( run_id, operation_session_id, operation_id, company_name, course_name, start_date, end_date, input_kind, input_value, result_kind, folder_id, folder_title, folder_url, file_count, candidate_count, key_candidates, folder_candidates, issues, error ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19)",
 finishRun:"update drive_import_runs set status = $2, scanned_ref_count = $3, scan_found_folder_count = $4, scan_issue_count = $5, folder_search_count = $6, folder_search_with_candidates_count = $7, avg_satisfaction_candidate_count = $8, instructor_satisfaction_candidate_count = $9, instructor_candidate_count = $10, suspicious_candidate_count = $11, error_count = $12, summary = $13::jsonb, finished_at = now() where id = $1"
};
export function classifySQL(text:string):string{const norm=(v:string)=>v.trim().replace(/\s+/g," ").toLowerCase();const normalized=norm(text);for(const [kind,shape] of Object.entries(sqlShapes))if(norm(shape)===(kind==="loadOperations"?normalized.replace(/ limit [0-9]+$/,""):normalized))return kind;throw new Error("UNEXPECTED_SQL_SHAPE");}

export function sqlShapeNegatives(){assert.equal(classifySQL(sqlShapes.loadOperations+' limit 1'),'loadOperations');assert.throws(()=>classifySQL(sqlShapes.loadOperations+'; DELETE FROM companies'));assert.throws(()=>classifySQL(sqlShapes.appendResult.replace('operation_session_id','operation_id')));}
