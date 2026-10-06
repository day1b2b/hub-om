/** Original-only observation gate. Parent executes; no current/native acceptance. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { PrismaClient } from "@prisma/client";
import { frozen, installFrozenResolver, verifyClosure } from "./frozen-loader.fixture.ts";
const URL = "postgresql://synthetic@127.0.0.1:56752/notion_import_test";
const ROOT = "/private/tmp/hub-om-notion-import-20260930";
async function send(value: unknown) { assert.ok(process.send); await new Promise<void>((resolve,reject)=>process.send!(value,e=>e?reject(e):resolve())); }
async function main() {
  verifyClosure();
  assert.equal(process.env.PG_NOTION_TEST_DATABASE_URL,URL);
  assert.equal(process.env.PG_NOTION_TEST_DATA_DIRECTORY,`${ROOT}/pg`);
  for (const key of ["DATABASE_URL","DIRECT_URL","MONGODB_URI","PII_ENCRYPTION_KEYS","PII_INDEX_KEY","DEV_AUTH_BYPASS"]) assert.equal(process.env[key],undefined);
  Object.assign(process.env,{DATABASE_URL:URL,TZ:"UTC",PII_ACTIVE_KEY_ID:"notiongate",PII_ENCRYPTION_KEYS:JSON.stringify({notiongate:randomBytes(32).toString("base64")}),PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false"});
  const authURL=`data:text/javascript;base64,${Buffer.from('export async function auth(){return {user:{email:"synthetic@day1company.co.kr",name:"Synthetic Gate"},expires:""};}').toString("base64")}`;
  installFrozenResolver(authURL);
  const sql=new pg.Client({connectionString:URL,connectionTimeoutMillis:5000,query_timeout:15000,options:"-c timezone=UTC -c statement_timeout=15000"});
  let prisma:PrismaClient|undefined,owned=false;
  const runs=new Set<string>(),audits=new Set<string>();
  let pages:unknown[][]=[[]],expectedToken="SYNTHETIC_NOTION_TOKEN";
  const calls:Array<{url:string;options:unknown}>=[];
  globalThis.fetch=async(input,options)=>{
    const url=String(input),index=calls.length;
    assert.match(url,/^https:\/\/api\.notion\.com\/v1\/databases\/[0-9a-f-]+\/query$/i,"EXTERNAL_FETCH_FORBIDDEN");
    assert.ok(index<pages.length,"unexpected pagination call");
    assert.equal((options?.headers as Record<string,string>).Authorization,`Bearer ${expectedToken}`);
    assert.deepEqual(options,{method:"POST",headers:{Authorization:`Bearer ${expectedToken}`,"Content-Type":"application/json","Notion-Version":"2022-06-28"},body:JSON.stringify({page_size:100,...(index?{start_cursor:`cursor-${index}`}:{})}),cache:"no-store"});
    calls.push({url,options:{...options,headers:{...(options!.headers as Record<string,string>),Authorization:"<synthetic-token-verified>"}}});
    return new Response(JSON.stringify({results:pages[index],has_more:index+1<pages.length,next_cursor:index+1<pages.length?`cursor-${index+1}`:null}),{status:200,headers:{"content-type":"application/json"}});
  };
  try {
    await sql.connect();
    assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows,[{db:"notion_import_test",usr:"synthetic",port:56752}]);
    assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory,`${ROOT}/pg`);
    assert.equal((await sql.query("SELECT pg_try_advisory_lock(84567056752::bigint) AS owned")).rows[0].owned,true);
    // Parent migrates first. This worker neither migrates nor resets public schema.
    for(const table of ["data_import_runs","operation_source_records","activity_requests","activity_changes","members","team_users","instructor_notes","companies","courses","operation_sessions"]){
      assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n),0,`gate needs empty owned table ${table}`);
    }
    owned=true;
    prisma=(await frozen<{getPrismaClient():PrismaClient}>("src/lib/data/prisma.ts")).getPrismaClient();
    const imp=await frozen<{POST(r:Request):Promise<Response>}>("src/app/api/admin/imports/notion/import/route.ts");
    const repo=(await frozen<{getImportRepository():{listImportRuns():Promise<unknown>;getImportRunById(id:string):Promise<unknown>}}>("src/lib/data/importRepositoryFactory.ts")).getImportRepository();
    const id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",alt="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const envKeys=["NOTION_TOKEN","NOTION_API_KEY","NOTION_TEAM1_RESOURCE_DATABASE_ID","NOTION_TEAM1_RESOURCE_URL","NOTION_TEAM2_RESOURCE_DATABASE_ID","NOTION_TEAM2_RESOURCE_URL","NOTION_IMPORT_DATABASE_ID","NOTION_IMPORT_DATABASE_URL"];
    async function observe(name:string,source:unknown[][],body:Record<string,unknown>,env:Record<string,string>={NOTION_TOKEN:"SYNTHETIC_NOTION_TOKEN"},rawBody?:string){
      for(const key of envKeys)delete process.env[key];Object.assign(process.env,env);
      expectedToken=env.NOTION_TOKEN??env.NOTION_API_KEY??"";pages=source;calls.length=0;
      const before=Date.now();const response=await imp.POST(new Request("http://synthetic.invalid/api/admin/imports/notion/import",{method:"POST",headers:{"content-type":"application/json"},body:rawBody??JSON.stringify(body)}));
      const after=Date.now(),json=await response.json() as {importRunId?:string};
      const requestId=response.headers.get("X-Request-Id");assert.ok(requestId);audits.add(requestId);
      let stored:unknown=null,raw:unknown=null,detail:unknown=null;
      if(json.importRunId){runs.add(json.importRunId);stored=await prisma!.dataImportRun.findUniqueOrThrow({where:{id:json.importRunId},include:{sourceRecords:{orderBy:{sourceRowNumber:"asc"}}}});raw={run:(await sql.query("SELECT * FROM data_import_runs WHERE id=$1",[json.importRunId])).rows,rows:(await sql.query("SELECT * FROM operation_source_records WHERE import_run_id=$1 ORDER BY source_row_number",[json.importRunId])).rows};detail=await repo.getImportRunById(json.importRunId);}
      const audit=await prisma!.activityRequest.findUniqueOrThrow({where:{id:requestId}});assert.equal(audit.status,response.status);
      await send({kind:"observation",name,before,after,status:response.status,body:json,calls:[...calls],stored,raw,detail,summary:await repo.listImportRuns(),audit});
    }
    const normal={id:"11111111-1111-1111-1111-111111111111",url:"https://synthetic.invalid/notion/page",properties:{"기업명":{type:"rich_text",rich_text:[{plain_text:"SYNTHETIC_COMPANY"}]},"과정명":{type:"title",title:[{plain_text:"SYNTHETIC_COURSE"}]},Date:{type:"date",date:{start:"2032-02-03T23:00:00-08:00",end:null}},"차수":{type:"formula",formula:{type:"number",number:0}},Tags:{type:"formula",formula:{type:"boolean",boolean:false}}}};
    const cases:Array<[string,unknown[][],Record<string,unknown>,Record<string,string>?,string?]>=[
      ["normal-property-count",[[normal]],{databaseUrl:id,sourceName:"gate-normal"}],
      ["pagination-empty-middle",[[normal],[],[{...normal,id:"22222222-2222-2222-2222-222222222222"}]],{databaseUrl:id,sourceName:"gate-pages"}],
      ["empty-properties-id-row",[[{id:"33333333-3333-3333-3333-333333333333",properties:{}}]],{databaseUrl:id,sourceName:"gate-empty-properties"}],
      ["sourceName-number-normal",[[normal]],{databaseUrl:id,sourceName:123}],
      ["sourceName-number-empty",[[]],{databaseUrl:id,sourceName:123}],
      ["malformed-id",[[{properties:{}}]],{databaseUrl:id}],
      ["malformed-eager-title",[[{...normal,properties:{...normal.properties,Broken:null}}]],{databaseUrl:id}],
      ["no-token-before-json",[[]],{}, {},"{"],
      ["empty-token-blocks-key",[[]],{databaseUrl:id},{NOTION_TOKEN:"",NOTION_API_KEY:"SYNTHETIC_KEY"}],
      ["token-wins",[[]],{databaseUrl:id},{NOTION_TOKEN:"SYNTHETIC_TOKEN_A",NOTION_API_KEY:"SYNTHETIC_TOKEN_B"}],
      ["key-fallback",[[]],{databaseUrl:id},{NOTION_API_KEY:"SYNTHETIC_KEY"}],
      ["space-token",[[]],{databaseUrl:id},{NOTION_TOKEN:" "}],
      ["no-url",[[]],{}],
      ["database-number",[[]],{databaseUrl:123,notionUrl:id}],
      ["first-url-shortcircuit",[[]],{databaseUrl:id,notionUrl:123}],
      ["trim-url-fallback",[[]],{databaseUrl:"  ",notionUrl:alt}],
      ["team1-id",[[]],{sourceTeam:"1팀"},{NOTION_TOKEN:"SYNTHETIC_NOTION_TOKEN",NOTION_TEAM1_RESOURCE_DATABASE_ID:id,NOTION_TEAM1_RESOURCE_URL:alt}],
      ["team2-empty-id-url",[[]],{sourceTeam:"team_2"},{NOTION_TOKEN:"SYNTHETIC_NOTION_TOKEN",NOTION_TEAM2_RESOURCE_DATABASE_ID:"",NOTION_TEAM2_RESOURCE_URL:alt}],
      ["unknown-import-id",[[]],{sourceTeam:"other"},{NOTION_TOKEN:"SYNTHETIC_NOTION_TOKEN",NOTION_IMPORT_DATABASE_ID:id,NOTION_IMPORT_DATABASE_URL:alt}],
      ["team-no-general-fallback",[[]],{sourceTeam:"team_1"},{NOTION_TOKEN:"SYNTHETIC_NOTION_TOKEN",NOTION_IMPORT_DATABASE_ID:id}],
      ["space-env-id",[[]],{sourceTeam:"team_1"},{NOTION_TOKEN:"SYNTHETIC_NOTION_TOKEN",NOTION_TEAM1_RESOURCE_DATABASE_ID:" ",NOTION_TEAM1_RESOURCE_URL:id}],
      ["compact-before-dashed",[[]],{databaseUrl:`${alt} aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`}]
    ];
    for(const [name,source,body,env,rawBody] of cases)await observe(name,source,body,env,rawBody);
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
