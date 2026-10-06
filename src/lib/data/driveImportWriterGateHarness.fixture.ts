/** Parent-executed PG technical gates only. No migrations, schema edits, or guard bypass. */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync,mkdirSync,readFileSync,existsSync } from "node:fs";
import pg from "pg";
import { manifest,BASELINE,ROOT as REPO,hash,verifyOriginal,verifyBytes,originalBytes,resolveEdge,rejectCurrentEscape } from "../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts";
import { ROOT,DATABASES,IDS,LINK,ISSUES,SUMMARY,expectedDates,assertTrace,traceNegativeControls,type Report,type Variant } from "./driveImportWriterGateContract.fixture.ts";
export interface Diagnostic {diagnostic(message:string):void}
const tables=["drive_import_results","drive_import_runs","operation_sessions","courses","companies"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function prefixExpected(count:number){return manifest.migrations.slice(0,count).map(path=>({path,sha256:manifest.files.find(e=>e.originPath===path)!.sha256}));}
function assertPrefix(actual:unknown,count:number){assert.deepEqual(actual,prefixExpected(count),"MIGRATION_PREFIX_HASH_MISMATCH");}
export async function verifyGateIndependence(){
 verifyOriginal();
 for(const path of ["scripts/run-drive-import-dry-run.mjs","scripts/assert-legacy-storage.mjs","src/lib/driveImports/googleDriveOperationScanner.ts","scripts/ts-loader.mjs",manifest.migrations[16]]){
  assert.throws(()=>verifyBytes(path,Buffer.concat([originalBytes(path),Buffer.from("\n// synthetic drift\n")])),{name:"AssertionError"});
 }
 assert.throws(()=>resolveEdge("scripts/run-drive-import-dry-run.mjs","../src/lib/data/current-escape.ts"),{name:"AssertionError"});
 await rejectCurrentEscape();
 const bad=prefixExpected(17);bad[0]={...bad[0],sha256:"0".repeat(64)};assert.throws(()=>assertPrefix(bad,17),{name:"AssertionError"});
}
class ObservedTimeout extends Error {}
async function child(variant:Variant,tz:string):Promise<{report:Report;exit:number|null;cwd:string;stderrHash:string;stderrBytes:number;stdoutBytes:number}>{
 mkdirSync(ROOT,{recursive:true});const cwd=mkdtempSync(`${ROOT}/gate-cwd-`);
 assert.equal(existsSync(`${cwd}/.env`),false);assert.equal(existsSync(`${cwd}/.env.local`),false);
 const env=Object.fromEntries(["PATH","HOME","TMPDIR"].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]!]]));
 const worker=fork(new URL("./driveImportWriterGateChild.fixture.ts",import.meta.url),[variant],{cwd,env:{...env,NODE_ENV:"test",LC_ALL:"C",TZ:tz,DATABASE_URL:`postgresql://synthetic@127.0.0.1:56753/${DATABASES[variant]}`,PGOPTIONS:"-c timezone=UTC -c statement_timeout=15000",PGAPPNAME:"synthetic-drive-writer-gate"},execArgv:["--experimental-strip-types","--experimental-loader",`${REPO}scripts/ts-loader.mjs`],stdio:["ignore","pipe","pipe","ipc"]});
 const stderr:Buffer[]=[],stdout:Buffer[]=[];worker.stderr?.on("data",b=>stderr.push(Buffer.from(b)));worker.stdout?.on("data",b=>stdout.push(Buffer.from(b)));
 const exit=await new Promise<number|null>((resolve,reject)=>{
  let timedOut=false,kill:ReturnType<typeof setTimeout>|undefined;
  const timer=setTimeout(()=>{timedOut=true;worker.kill("SIGTERM");kill=setTimeout(()=>{worker.kill("SIGKILL");},5000);},60000);
  worker.once("error",()=>{if(worker.pid===undefined){clearTimeout(timer);reject(new Error("CLI_SPAWN_FAILED"));}});
  worker.once("exit",(code,signal)=>{clearTimeout(timer);clearTimeout(kill);if(timedOut)reject(new ObservedTimeout(`CLI_TIMEOUT_OBSERVED_EXIT:${code}/${signal}; STOP; OWNED_RESOURCE_AUDIT_REQUIRED; CLEANUP_NOT_CONFIRMED`));else if(signal)reject(new ObservedTimeout(`CLI_SIGNAL_OBSERVED_EXIT:${signal}; STOP; OWNED_RESOURCE_AUDIT_REQUIRED`));else resolve(code);});
 });
 assert.ok(existsSync(`${cwd}/observer.json`),"CHILD_REPORT_MISSING_NO_RAW_STDERR_PRINTED");
 const report=JSON.parse(readFileSync(`${cwd}/observer.json`,"utf8")) as Report;
 return {report,exit,cwd,stderrHash:hash(Buffer.concat(stderr)),stderrBytes:Buffer.concat(stderr).length,stdoutBytes:Buffer.concat(stdout).length};
}
export async function runTechnicalGate(t:Diagnostic,variant:Variant,tz:string){
 const database=DATABASES[variant],count=variant==="legacy"?17:variant==="no_defaults"?18:45;
 const sql=new pg.Client({connectionString:`postgresql://synthetic@127.0.0.1:56753/${database}`,connectionTimeoutMillis:5000,query_timeout:15000,options:"-c timezone=UTC -c statement_timeout=15000"});
 let owned=false,retain=false;
 try{
  await sql.connect();assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows,[{db:database,usr:"synthetic",port:56753}]);
  assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory,`${ROOT}/pg`);
  assert.equal((await sql.query("SELECT pg_try_advisory_lock(84567056753::bigint) AS owned")).rows[0].owned,true);
  assert.equal(Number((await sql.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")).rows[0].n),0,"PG_GATE_REQUIRES_EXCLUSIVE_DB");
  const applied=JSON.parse(readFileSync(`${ROOT}/migration-prefixes.json`,"utf8")) as {base:string;databases:Array<{database:string;migrations:unknown}>};assert.equal(applied.base,BASELINE);
  let applicationEvidence:string;
  if(variant!=="current"){const entry=applied.databases.find(d=>d.database===database);assert.ok(entry,"PARENT_PREFIX_LEDGER_MISSING");assertPrefix(entry.migrations,count);applicationEvidence="parent-original-prefix-ledger+catalog";}
  else{
   const rows=(await sql.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
   assertPrefix(rows.map(row=>({path:`prisma/migrations/${row.migration_name}/migration.sql`,sha256:row.checksum})),45);applicationEvidence="actual-prisma-migration-history+catalog";
  }
  const catalog=(await sql.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position",[tables])).rows;
  function column(table:string,name:string){const c=catalog.find(c=>c.table_name===table&&c.column_name===name);assert.ok(c,"REQUIRED_CATALOG_COLUMN_MISSING");return c;}
  for(const table of ["drive_import_runs","drive_import_results"]){const c=column(table,"id");assert.equal(c.data_type,"uuid");assert.equal(c.is_nullable,"NO");assert.equal(c.column_default,variant==="legacy"?"gen_random_uuid()":null);}
  for(const name of ["id","operation_id","course_record_id","deleted_at","om_name","ld_name","drive_link","lecture_management_link"])column("operation_sessions",name);
  for(const name of ["id","company_id","course_name"])column("courses",name);for(const name of ["id","name"])column("companies",name);
  for(const name of ["start_date","end_date"]){assert.equal(column("operation_sessions",name).data_type,"date");assert.equal(column("operation_sessions",name).is_nullable,"NO");assert.equal(column("drive_import_results",name).data_type,"date");assert.equal(column("drive_import_results",name).is_nullable,"YES");}
  for(const [table,names] of [["drive_import_runs",["summary"]],["drive_import_results",["key_candidates","folder_candidates","issues"]]] as const)for(const name of names)assert.equal(column(table,name).data_type,"jsonb");
  const fks=(await sql.query("SELECT conname,confdeltype,confupdtype FROM pg_constraint WHERE conrelid='public.drive_import_results'::regclass AND contype='f' ORDER BY conname")).rows;
  assert.deepEqual(fks,[{conname:"drive_import_results_operation_session_id_fkey",confdeltype:"n",confupdtype:"c"},{conname:"drive_import_results_run_id_fkey",confdeltype:"c",confupdtype:"c"}]);
  const encrypted=(await sql.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coaches' AND column_name='name_pii_index') AS present")).rows[0].present;assert.equal(encrypted,variant==="current");
  for(const table of tables)assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n),0,"GATE_REQUIRES_EMPTY_OWNED_TABLES");
  owned=true;
  // Seed is fixture-owned and explicit; no implicit UUID defaults for business parents.
  if(variant!=="current"){
   await sql.query("INSERT INTO companies(id,name,normalized_name,updated_at) VALUES($1,'SYNTHETIC_COMPANY','synthetic_company','2030-01-01')",[IDS.company]);
   await sql.query("INSERT INTO courses(id,company_id,course_id,course_name,updated_at) VALUES($1,$2,'SYNTHETIC_COURSE_ID','SYNTHETIC_COURSE','2030-01-01')",[IDS.course,IDS.company]);
   for(const scan of [true,false])await sql.query("INSERT INTO operation_sessions(id,operation_id,course_record_id,start_date,end_date,om_name,ld_name,drive_link,lecture_management_link,updated_at) VALUES($1,$2,$3,'2032-02-03','2032-02-04','SYNTHETIC_OM',NULL,$4,NULL,'2030-01-01')",[scan?IDS.scan:IDS.search,scan?"SYNTHETIC_GATE_SCAN":"SYNTHETIC_GATE_SEARCH",IDS.course,scan?` ${LINK} `:null]);
  }
  const businessState=async()=>hash(JSON.stringify(await Promise.all(["companies","courses","operation_sessions"].map(async table=>(await sql.query(`SELECT row_to_json(t) AS value FROM "${table}" t ORDER BY id`)).rows))));
  const auditTables=(await sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('activity_requests','activity_changes') ORDER BY table_name")).rows.map(r=>String(r.table_name));
  const auditState=async()=>hash(JSON.stringify(await Promise.all(auditTables.map(async table=>(await sql.query(`SELECT row_to_json(t) AS value FROM "${table}" t ORDER BY id`)).rows))));
  const beforeBusiness=await businessState(),beforeAudit=await auditState();
  const rawDates=(await sql.query("SELECT operation_id,start_date::text,end_date::text FROM operation_sessions ORDER BY operation_id")).rows;
  if(variant!=="current")assert.deepEqual(rawDates,[{operation_id:"SYNTHETIC_GATE_SCAN",start_date:"2032-02-03",end_date:"2032-02-04"},{operation_id:"SYNTHETIC_GATE_SEARCH",start_date:"2032-02-03",end_date:"2032-02-04"}]);
  const before=Date.now();let observation:Awaited<ReturnType<typeof child>>;
  try{observation=await child(variant,tz);}catch(error){if(error instanceof ObservedTimeout)retain=true;throw error;}
  const after=Date.now(),r=observation.report;assertTrace(r,variant);traceNegativeControls(r,variant);assert.equal(observation.exit,variant==="legacy"?0:1);assert.equal(observation.stdoutBytes,0,"UNFILTERED_CHILD_STDOUT");
  assert.equal(await businessState(),beforeBusiness,"BUSINESS_RAW_CHANGED");assert.equal(await auditState(),beforeAudit,"CLI_ACTIVITY_WRITE");
  const runs=(await sql.query("SELECT * FROM drive_import_runs ORDER BY id")).rows;
  const results=(await sql.query("SELECT *,start_date::text AS start_text,end_date::text AS end_text FROM drive_import_results ORDER BY operation_id,id")).rows;
  if(variant!=="legacy"){assert.equal(runs.length,0);assert.equal(results.length,0);}
  else{
   assert.equal(runs.length,1);assert.equal(results.length,2);const run=runs[0],dates=expectedDates(tz);assert.match(run.id,uuid);
   assert.equal(run.id,r.queries.find(q=>q.kind==="createRun")?.returnedRunId);
   for(const at of [run.started_at,run.finished_at,...results.map(row=>row.created_at)]){assert.ok(at instanceof Date);assert.ok(at.getTime()>=before-2&&at.getTime()<=after+2,"DYNAMIC_TIME_OUTSIDE_CALL");}
   assert.deepEqual(run,{id:run.id,mode:"dry_run",status:"completed",operation_count:2,scanned_ref_count:1,scan_found_folder_count:1,scan_issue_count:1,folder_search_count:1,folder_search_with_candidates_count:0,avg_satisfaction_candidate_count:0,instructor_satisfaction_candidate_count:0,instructor_candidate_count:0,suspicious_candidate_count:0,error_count:0,summary:SUMMARY,notes:"Read-only Drive import dry run. Operation data is not modified.",started_at:run.started_at,finished_at:run.finished_at});
   assert.equal(new Set(results.map(row=>row.id)).size,2);
   for(const [i,row] of results.entries()){
    const scan=i===0;assert.match(row.id,uuid);assert.equal(row.start_text,dates.start);assert.equal(row.end_text,dates.end);
    // Supervisor TZ is UTC; compare DATE text explicitly rather than normalize away the CLI's timezone shift.
    assert.ok(row.start_date instanceof Date);assert.ok(row.end_date instanceof Date);assert.equal(row.start_date.toISOString(),`${dates.start}T00:00:00.000Z`);assert.equal(row.end_date.toISOString(),`${dates.end}T00:00:00.000Z`);
    assert.deepEqual(row,{id:row.id,run_id:run.id,operation_session_id:scan?IDS.scan:IDS.search,operation_id:scan?"SYNTHETIC_GATE_SCAN":"SYNTHETIC_GATE_SEARCH",company_name:"SYNTHETIC_COMPANY",course_name:"SYNTHETIC_COURSE",start_date:row.start_date,end_date:row.end_date,input_kind:scan?"driveLink":"folderSearch",input_value:scan?LINK:"",result_kind:scan?"scan_found_folder":"folder_search_empty",folder_id:scan?"SYNTHETIC_FOLDER_000001":null,folder_title:scan?"":null,folder_url:scan?LINK:null,file_count:0,candidate_count:0,key_candidates:[],folder_candidates:[],issues:ISSUES,error:null,created_at:row.created_at,start_text:dates.start,end_text:dates.end});
   }
   assert.deepEqual(r.stdout,["[drive-import-dry-run] 2/2",{runId:run.id,status:"completed",summary:SUMMARY}]);
  }
  t.diagnostic(JSON.stringify({kind:"gate",variant,tz,prefix:count,applicationEvidence,exit:observation.exit,reportPath:`${observation.cwd}/observer.json`,stderrHash:observation.stderrHash,stderrBytes:observation.stderrBytes,rawDates,report:r,dmlAttempts:r.queries.filter(q=>["createRun","appendResult","finishRun"].includes(q.kind)).length,sourceCalls:r.sources.length,runCount:runs.length,resultCount:results.length,resultDates:results.map(row=>({operationId:row.operation_id,start:row.start_text,end:row.end_text})),businessRawUnchanged:true,activityUnchanged:true}));
 }finally{
  try {
  if(owned&&!retain){
   // Dedicated DB began empty; only this gate's history/seed is removable. No schema reset.
   if(variant!=="current"){await sql.query("DELETE FROM drive_import_results");await sql.query("DELETE FROM drive_import_runs");
   await sql.query("DELETE FROM operation_sessions WHERE id=ANY($1::uuid[])",[[IDS.scan,IDS.search]]);await sql.query("DELETE FROM courses WHERE id=$1",[IDS.course]);await sql.query("DELETE FROM companies WHERE id=$1",[IDS.company]);}
   for(const table of tables)assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n),0,"OWNED_CLEANUP_REMAINS");t.diagnostic(JSON.stringify({kind:"cleanup",variant,tz,remaining:0}));
  }else if(retain)t.diagnostic("TIMEOUT: owned data retained; parent resource audit required; cleanup not confirmed");
  } finally { await sql.end(); }
 }
}
