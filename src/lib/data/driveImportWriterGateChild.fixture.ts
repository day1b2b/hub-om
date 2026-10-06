/** Executes the unchanged CLI. Observer delegates real pg and real scanner; no return substitution. */
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { pathToFileURL } from "node:url";
import { installOriginalResolver,originalURL } from "../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts";
import { DATABASES,ROOT,IDS,LINK,ISSUES,GUARD_ERROR,expectedDates,SUMMARY,type Report,type Variant } from "./driveImportWriterGateContract.fixture.ts";
const report:Report={queries:[],sources:[],violations:[],connects:0,ends:0,fetches:0,stdout:[]};
const reportPath=`${process.cwd()}/observer.json`;
const variant=process.argv[2] as Variant;
const dates=expectedDates(process.env.TZ??"");
function flush(){fs.writeFileSync(reportPath,JSON.stringify(report));}
function observe(check:()=>void,code:string){try{check();return true;}catch{report.violations.push(code);return false;}}
const normalize=(sql:string)=>sql.trim().replace(/\s+/g," ").toLowerCase();
const sqlTexts={
 guard:"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coaches' AND column_name = 'name_pii_index') AS encrypted",
 load:"select s.id, s.operation_id, co.name as company_name, c.course_name, s.start_date, s.end_date, s.om_name, s.ld_name, s.drive_link, s.lecture_management_link from operation_sessions s join courses c on c.id = s.course_record_id join companies co on co.id = c.company_id where s.deleted_at is null order by s.start_date asc, s.operation_id asc",
 createRun:"insert into drive_import_runs (mode, status, operation_count, notes) values ($1, 'pending', $2, $3) returning id",
 appendResult:"insert into drive_import_results ( run_id, operation_session_id, operation_id, company_name, course_name, start_date, end_date, input_kind, input_value, result_kind, folder_id, folder_title, folder_url, file_count, candidate_count, key_candidates, folder_candidates, issues, error ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19)",
 finishRun:"update drive_import_runs set status = $2, scanned_ref_count = $3, scan_found_folder_count = $4, scan_issue_count = $5, folder_search_count = $6, folder_search_with_candidates_count = $7, avg_satisfaction_candidate_count = $8, instructor_satisfaction_candidate_count = $9, instructor_candidate_count = $10, suspicious_candidate_count = $11, error_count = $12, summary = $13::jsonb, finished_at = now() where id = $1"
};
let runId="";
const globals=globalThis as unknown as {__driveGateClient:unknown;__driveGateSource:unknown};
globals.__driveGateClient=function(config:pg.ClientConfig){
 assert.equal(config.connectionString,`postgresql://synthetic@127.0.0.1:56753/${DATABASES[variant]}`);
 const client=new pg.Client(config),query=client.query.bind(client) as (text:string,values?:unknown[])=>Promise<pg.QueryResult>;
 const connect=client.connect.bind(client),end=client.end.bind(client);
 client.connect=(async()=>{report.connects++;flush();return await connect();}) as typeof client.connect;
 client.end=(async()=>{report.ends++;flush();await end();}) as typeof client.end;
 client.query=(async(text:string,params?:unknown[])=>{
  const kind=Object.entries(sqlTexts).find(([,sql])=>normalize(sql)===normalize(text))?.[0]??"unexpected";
  if(kind==="unexpected")report.violations.push("UNEXPECTED_SQL");
  const observation:Report["queries"][number]={kind,ok:false};report.queries.push(observation);flush();
  try{
   const result=await query(text,params);observation.ok=true;
   if(kind==="guard")observation.encrypted=result.rows[0]?.encrypted;
   if(kind==="load"){
    const projected=result.rows.map(row=>({...row,start_date:row.start_date instanceof Date?{type:"Date",iso:row.start_date.toISOString()}:{type:typeof row.start_date},end_date:row.end_date instanceof Date?{type:"Date",iso:row.end_date.toISOString()}:{type:typeof row.end_date}}));
    const expected=[true,false].map(scan=>({id:scan?IDS.scan:IDS.search,operation_id:scan?"SYNTHETIC_GATE_SCAN":"SYNTHETIC_GATE_SEARCH",company_name:"SYNTHETIC_COMPANY",course_name:"SYNTHETIC_COURSE",start_date:{type:"Date",iso:dates.driverStart},end_date:{type:"Date",iso:dates.driverEnd},om_name:"SYNTHETIC_OM",ld_name:null,drive_link:scan?` ${LINK} `:null,lecture_management_link:null}));
    if(observe(()=>assert.deepEqual(projected,expected),"LOAD_DRIVER_CONTRACT"))observation.driverRows=projected;
   }
   if(kind==="createRun"){
    observe(()=>assert.deepEqual(params,["dry_run",2,"Read-only Drive import dry run. Operation data is not modified."]),"CREATE_PARAMS");
    if(observe(()=>assert.match(result.rows[0]?.id,/^[0-9a-f-]{36}$/),"RUN_ID")){runId=result.rows[0].id;observation.returnedRunId=runId;}
   }
   if(kind==="appendResult"){
    const scan=params?.[1]===IDS.scan;
    const expected=[runId,scan?IDS.scan:IDS.search,scan?"SYNTHETIC_GATE_SCAN":"SYNTHETIC_GATE_SEARCH","SYNTHETIC_COMPANY","SYNTHETIC_COURSE",dates.start,dates.end,scan?"driveLink":"folderSearch",scan?LINK:"",scan?"scan_found_folder":"folder_search_empty",scan?"SYNTHETIC_FOLDER_000001":null,scan?"":null,scan?LINK:null,0,0,"[]","[]",JSON.stringify(ISSUES),null];
    if(observe(()=>assert.deepEqual(params,expected),"RESULT_PARAMS"))observation.params=params;
   }
   if(kind==="finishRun")observe(()=>assert.deepEqual(params,[runId,"completed",1,1,1,1,0,0,0,0,0,0,JSON.stringify(SUMMARY)]),"FINISH_PARAMS");
   flush();return result;
  }catch(error){const code=(error as {code?:unknown})?.code;if(typeof code==="string"&&/^[0-9A-Z]{5}$/.test(code))observation.code=code;flush();throw error;}
 }) as typeof client.query;
 return client;
};
globals.__driveGateSource=async(method:string,fn:(...args:unknown[])=>Promise<unknown>,args:unknown[])=>{
 const safeArgs=observe(()=>{
  if(method==="scan")assert.deepEqual(args,[LINK]);
  else{assert.equal(method,"search");assert.deepEqual(args,[{id:IDS.search,operationId:"SYNTHETIC_GATE_SEARCH",companyName:"SYNTHETIC_COMPANY",courseName:"SYNTHETIC_COURSE",startDate:dates.start,endDate:dates.end,om:"SYNTHETIC_OM",ld:"",driveLink:"",lectureManagementLink:""}]);}
 },"SOURCE_INPUT");
 const result=await fn(...args) as Record<string,unknown>;
 const safeResult=observe(()=>{
  if(method==="scan"){assert.equal(typeof result.scannedAt,"string");assert.deepEqual(result,{folderId:"SYNTHETIC_FOLDER_000001",folderTitle:"",folderUrl:LINK,scannedAt:result.scannedAt,candidates:[],files:[],issues:ISSUES});}
  else{assert.equal(typeof result.searchedAt,"string");assert.deepEqual(result,{candidates:[],issues:ISSUES,searchedAt:result.searchedAt});}
 },"REAL_SCANNER_ISSUES");
 report.sources.push({method,args:safeArgs?args:[],result:safeResult?result:{redacted:true}});flush();return result;
};
globalThis.fetch=async()=>{report.fetches++;report.violations.push("EXTERNAL_FETCH_FORBIDDEN");flush();throw new Error("EXTERNAL_FETCH_FORBIDDEN");};
console.log=(...args:unknown[])=>{
 const value=args[0];let safe:unknown;
 if(typeof value==="string"&&/^\[drive-import-dry-run\] \d+\/\d+$/.test(value))safe=value;
 else if(typeof value==="string")observe(()=>{const parsed=JSON.parse(value);assert.deepEqual(parsed,{runId,status:"completed",summary:SUMMARY});safe=parsed;},"UNEXPECTED_STDOUT");
 else report.violations.push("UNEXPECTED_STDOUT");
 if(safe!==undefined)report.stdout.push(safe);flush();
};
console.error=(error:unknown)=>{
 const value=error as {message?:unknown;code?:unknown};
 report.error={guard:value?.message===GUARD_ERROR};if(typeof value?.code==="string"&&/^[0-9A-Z]{5}$/.test(value.code))report.error.code=value.code;
 flush();
};
process.on("exit",code=>{report.exitCode=code;flush();});
async function main(){
 assert.ok(Object.hasOwn(DATABASES,variant));assert.ok(process.cwd().startsWith(`${ROOT}/gate-cwd-`));
 for(const name of [".env",".env.local"])assert.equal(fs.existsSync(name),false);
 for(const key of ["GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL","GOOGLE_DRIVE_PRIVATE_KEY","GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL","GOOGLE_CALENDAR_PRIVATE_KEY"])assert.equal(process.env[key],undefined);
 const pgURL=`data:text/javascript,export const Client=globalThis.__driveGateClient;`;
 installOriginalResolver({pgURL,sourceObserverURL:actual=>`data:text/javascript;base64,${Buffer.from(`import {scanOperationDriveFolder as scan,searchOperationDriveFolders as search} from ${JSON.stringify(actual)};export const scanOperationDriveFolder=(...args)=>globalThis.__driveGateSource("scan",scan,args);export const searchOperationDriveFolders=(...args)=>globalThis.__driveGateSource("search",search,args);`).toString("base64")}`});
 // The original uses process.argv.slice(2); configure only its public CLI arguments.
 process.argv=[process.execPath,pathToFileURL(process.cwd()+"/original-cli.mjs").href,"--concurrency","1"];
 await import(originalURL("scripts/run-drive-import-dry-run.mjs"));
}
main().catch(()=>{report.bootstrapFailed=true;flush();process.exitCode=1;});
