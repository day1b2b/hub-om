/** Original-only observation gate. Parent executes; no current/native acceptance. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { PrismaClient } from "@prisma/client";
import { frozen, installFrozenResolver, verifyClosure } from "./frozen-loader.fixture.ts";
const URL = "postgresql://synthetic@127.0.0.1:56751/sheets_import_test";
const ROOT = "/private/tmp/hub-om-google-sheets-import-20260930";
async function send(value: unknown) { assert.ok(process.send); await new Promise<void>((resolve,reject)=>process.send!(value,e=>e?reject(e):resolve())); }
async function main() {
  verifyClosure();
  assert.equal(process.env.PG_SHEETS_TEST_DATABASE_URL,URL);
  assert.equal(process.env.PG_SHEETS_TEST_DATA_DIRECTORY,`${ROOT}/pg`);
  for (const key of ["DATABASE_URL","DIRECT_URL","MONGODB_URI","PII_ENCRYPTION_KEYS","PII_INDEX_KEY","DEV_AUTH_BYPASS"]) assert.equal(process.env[key],undefined);
  Object.assign(process.env,{DATABASE_URL:URL,TZ:"UTC",PII_ACTIVE_KEY_ID:"sheetsgate",PII_ENCRYPTION_KEYS:JSON.stringify({sheetsgate:randomBytes(32).toString("base64")}),PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false"});
  const authURL=`data:text/javascript;base64,${Buffer.from('export async function auth(){return {user:{email:"synthetic@day1company.co.kr",name:"Synthetic Gate"},googleAccessToken:"SYNTHETIC_SHEETS_TOKEN",expires:""};}').toString("base64")}`;
  installFrozenResolver(authURL);
  const sql=new pg.Client({connectionString:URL,connectionTimeoutMillis:5000,query_timeout:15000,options:"-c timezone=UTC -c statement_timeout=15000"});
  let prisma:PrismaClient|undefined,owned=false;
  const runs=new Set<string>(),audits=new Set<string>();
  let payload:unknown={values:[]};const calls:Array<{url:string;options:unknown}>=[];
  globalThis.fetch=async(input,options)=>{
    const url=String(input);
    assert.ok(url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/SYNTHETIC_SHEET"),"EXTERNAL_FETCH_FORBIDDEN");
    calls.push({url,options});return new Response(JSON.stringify(payload),{status:200,headers:{"content-type":"application/json"}});
  };
  try {
    await sql.connect();
    assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows,[{db:"sheets_import_test",usr:"synthetic",port:56751}]);
    assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory,`${ROOT}/pg`);
    assert.equal((await sql.query("SELECT pg_try_advisory_lock(84567056751::bigint) AS owned")).rows[0].owned,true);
    // Parent migrates first. This worker neither migrates nor resets public schema.
    for(const table of ["data_import_runs","operation_source_records","activity_requests","activity_changes","members","team_users","instructor_notes","companies","courses","operation_sessions"]){
      assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n),0,`gate needs empty owned table ${table}`);
    }
    owned=true;
    prisma=(await frozen<{getPrismaClient():PrismaClient}>("src/lib/data/prisma.ts")).getPrismaClient();
    const tabs=await frozen<{POST(r:Request):Promise<Response>}>("src/app/api/admin/imports/google-sheets/tabs/route.ts");
    const imp=await frozen<{POST(r:Request):Promise<Response>}>("src/app/api/admin/imports/google-sheets/import/route.ts");
    const repo=(await frozen<{getImportRepository():{listImportRuns():Promise<unknown>;getImportRunById(id:string):Promise<unknown>}}>("src/lib/data/importRepositoryFactory.ts")).getImportRepository();
    const sheet="https://docs.google.com/spreadsheets/d/SYNTHETIC_SHEET/edit?gid=0";
    async function observe(name:string,values:unknown,body:Record<string,unknown>,route=imp){
      payload=route===tabs?values:{values};calls.length=0;
      const before=Date.now();const response=await route.POST(new Request(`http://synthetic.invalid/api/admin/imports/google-sheets/${route===tabs?"tabs":"import"}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({spreadsheetUrl:sheet,tabTitle:"Synthetic ' Tab",...body})}));
      const after=Date.now(),json=await response.json() as {importRunId?:string};
      const requestId=response.headers.get("X-Request-Id");assert.ok(requestId);audits.add(requestId);
      let stored:unknown=null,raw:unknown=null,detail:unknown=null;
      if(json.importRunId){runs.add(json.importRunId);stored=await prisma!.dataImportRun.findUniqueOrThrow({where:{id:json.importRunId},include:{sourceRecords:{orderBy:{sourceRowNumber:"asc"}}}});raw={run:(await sql.query("SELECT * FROM data_import_runs WHERE id=$1",[json.importRunId])).rows,rows:(await sql.query("SELECT * FROM operation_source_records WHERE import_run_id=$1 ORDER BY source_row_number",[json.importRunId])).rows};detail=await repo.getImportRunById(json.importRunId);}
      const audit=await prisma!.activityRequest.findUniqueOrThrow({where:{id:requestId}});
      assert.equal(audit.status,response.status);
      await send({kind:"observation",name,before,after,status:response.status,body:json,calls:[...calls],stored,raw,detail,summary:await repo.listImportRuns(),audit});
    }
    const normal=[["기업명","과정명","시작일","종료일","미매핑"],["SYNTHETIC_COMPANY","SYNTHETIC_COURSE","2032-02-03","2032-02-04","SYNTHETIC_EXTRA"]];
    await observe("tabs-order",{sheets:[{properties:{sheetId:2,title:"Second",index:0}},{properties:{sheetId:0,title:"",index:9}},{properties:{sheetId:"bad",title:"skip"}}]}, {},tabs);
    for(const [name,values,body] of [
      ["normal",normal,{}],["sourceName-number-normal",normal,{sourceName:123}],
      ["sourceName-number-header-only",[normal[0]],{sourceName:123}],
      ["sourceName-number-empty-values",[],{sourceName:123}],
      ["malformed-row",[null],{}],["scalar-cells",[["企業","課程"],[123,false]],{}],
      ...[0,-1,1.5,99,"2"].map(value=>[`header-${value}`,normal,{headerRowNumber:value}]),
      ...[1999,2000,2100,2101,2032.5,"2032"].map(value=>[`year-${value}`,[["기업명","과정명","시작일"],["SYNTHETIC_C","SYNTHETIC_N","2/3"]],{importYear:value}])
    ] as Array<[string,unknown,Record<string,unknown>]>) await observe(name,values,body);
    await send({kind:"result",status:"ORIGINAL_OBSERVATIONS_ONLY_REVIEW_REQUIRED"});
  } finally {
    await prisma?.$disconnect();
    if(owned){
      // Capture any run created before an assertion/response failure; exclusive empty owned tables were required.
      const ids=(await sql.query("SELECT id FROM data_import_runs")).rows.map(r=>String(r.id));
      for(const id of ids)runs.add(id);
      await sql.query("DELETE FROM operation_source_records WHERE import_run_id=ANY($1::uuid[])",[[...runs]]);
      await sql.query("DELETE FROM data_import_runs WHERE id=ANY($1::uuid[])",[[...runs]]);
      const requestIds=(await sql.query("SELECT id FROM activity_requests")).rows.map(r=>String(r.id));for(const id of requestIds)audits.add(id);
      await sql.query("DELETE FROM activity_requests WHERE id=ANY($1::uuid[])",[[...audits]]);
      for(const table of ["data_import_runs","operation_source_records","activity_requests","activity_changes","companies","courses","operation_sessions"])
        assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n),0,`cleanup/sentinel ${table}`);
      await send({kind:"cleanup",remaining:0});
    }
    await sql.end();
  }
}
main().catch(async error=>{await send({kind:"failure",message:error instanceof Error?error.stack:String(error)});process.exitCode=1;});
