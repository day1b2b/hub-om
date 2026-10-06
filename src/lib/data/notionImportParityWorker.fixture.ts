/** Separate process per backend. Parent executes only. Gate/manifest remain immutable. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { MongoClient } from "mongodb";
import { Prisma, type PrismaClient } from "@prisma/client";
import { frozen,installFrozenResolver,verifyClosure } from "../../../.claude/plans/mongodb-notion-import/original/frozen-loader.fixture.ts";
import { currentAuthSeam } from "./notionImportParityLoader.fixture.ts";
import { EMAIL,DATABASE,TOKEN,DUP,page,fingerprint,record,dateText,type Row,type LiteralPage } from "./notionImportParityLiterals.fixture.ts";
import { expectedIds,registerId,registerRow,assertCompleteIds,identityNegativeControls } from "./notionImportParityIds.fixture.ts";
import type { ImportRepository } from "./importRepository";
import { bothReadsBeforeCommit, bothNativeReadsBeforeCommit } from "./notionImportParityRace.fixture.ts";
import type { DataRepositories } from "./dataRepositoryContext";
const PG="postgresql://synthetic@127.0.0.1:56752/notion_import_test",MONGO="mongodb://127.0.0.1:27852/?replicaSet=notionimport20260930";
const loadCurrent=<T>(origin:string)=>import(new URL(`../../../${origin}`,import.meta.url).href) as Promise<T>;
async function send(value:unknown){assert.ok(process.send);await new Promise<void>((resolve,reject)=>process.send!(value,e=>e?reject(e):resolve()));}
function canonical(v:unknown):string {if(v instanceof Date)return JSON.stringify(v.toISOString());if(Array.isArray(v))return `[${v.map(canonical).join(',')}]`;if(v&&typeof v==='object')return `{${Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;return JSON.stringify(v)??'null';}
const tables={DataImportRun:"data_import_runs",OperationSourceRecord:"operation_source_records",ActivityRequest:"activity_requests",ActivityChange:"activity_changes",Company:"companies",Course:"courses",OperationSession:"operation_sessions"} as const;
type Model=keyof typeof tables;
async function main(){
 verifyClosure();const backend=process.argv[2];assert.ok(["original","current","mongo"].includes(backend));
 assert.equal(process.env.PG_NOTION_TEST_DATABASE_URL,PG);assert.equal(process.env.PG_NOTION_TEST_DATA_DIRECTORY,"/private/tmp/hub-om-notion-import-20260930/pg");
 for(const key of ["DATABASE_URL","DIRECT_URL","PII_ENCRYPTION_KEYS","PII_INDEX_KEY","DEV_AUTH_BYPASS"])assert.equal(process.env[key],undefined);
 Object.assign(process.env,{TZ:"UTC",PII_ACTIVE_KEY_ID:"notionparity",PII_ENCRYPTION_KEYS:JSON.stringify({notionparity:randomBytes(32).toString("base64")}),PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false"});
 if(backend!=="mongo")process.env.DATABASE_URL=PG;
 process.env.NOTION_TOKEN=TOKEN;
 const authURL=`data:text/javascript;base64,${Buffer.from(`export async function auth(){return {user:{email:${JSON.stringify(EMAIL)},name:"Synthetic Parity"},expires:""};}`).toString("base64")}`;
 if(backend==="original")installFrozenResolver(authURL);else currentAuthSeam(authURL);
 const load=backend==="original"?frozen:loadCurrent;
 let sql:pg.Client|undefined,prisma:PrismaClient|undefined,client:MongoClient|undefined,owned=false,dbName="";
 let scope:Partial<DataRepositories>|undefined;
 let read:(m:Model)=>Promise<Row[]>;
 let raw:(m:Model)=>Promise<unknown>;
 let historical:(id:string,type:string)=>Promise<void>;
 let setRunTime:(id:string,at:Date)=>Promise<void>;
 let invoke:<T>(fn:()=>Promise<T>)=>Promise<T>=fn=>fn();
 const ledger:Array<{name:string;value:unknown}>=[];
 const mark=async(name:string,value:unknown="literal-pass")=>{ledger.push({name,value});await send({kind:"case",backend,name});};
 let transportPages:unknown[][]=[[]],faultAt=-1,fault:"http"|"json"|"transport"="http";
 const fetchCalls:Array<{url:string;options:unknown}>=[];
 function configure(rows:LiteralPage[],twoPages=false){
  transportPages=[];if(twoPages){transportPages=[rows.slice(0,1).map(r=>r.raw),rows.slice(1).map(r=>r.raw)];}
  else for(let i=0;i<rows.length;i+=100)transportPages.push(rows.slice(i,i+100).map(r=>r.raw));
  if(!transportPages.length)transportPages=[[]];fetchCalls.length=0;faultAt=-1;
 }
 globalThis.fetch=async(input,options)=>{
  const url=String(input);assert.equal(url,`https://api.notion.com/v1/databases/${DATABASE}/query`,"EXTERNAL_FETCH_FORBIDDEN");
  const body=JSON.parse(String(options?.body)) as {start_cursor?:string};
  const index=body.start_cursor===undefined?0:Number(body.start_cursor.replace("cursor-",""));
  assert.ok(Number.isInteger(index)&&index>=0&&index<transportPages.length);
  assert.deepEqual(options,{method:"POST",headers:{Authorization:`Bearer ${TOKEN}`,"Content-Type":"application/json","Notion-Version":"2022-06-28"},body:JSON.stringify({page_size:100,...(index?{start_cursor:`cursor-${index}`}:{})}),cache:"no-store"});
  fetchCalls.push({url,options:{...options,headers:{...(options!.headers as Record<string,string>),Authorization:"<verified>"}}});
  if(index===faultAt){if(fault==="transport")throw new Error("SYNTHETIC_TRANSPORT_CANARY");if(fault==="json")return new Response("{",{status:200});return new Response("SYNTHETIC_BODY_CANARY",{status:500,statusText:"SYNTHETIC_STATUS_CANARY"});}
  return new Response(JSON.stringify({results:transportPages[index],has_more:index+1<transportPages.length,next_cursor:index+1<transportPages.length?`cursor-${index+1}`:null}),{status:200,headers:{"content-type":"application/json"}});
 };
 try{
  if(backend!=="mongo"){
   sql=new pg.Client({connectionString:PG,connectionTimeoutMillis:5000,query_timeout:15000,options:"-c timezone=UTC -c statement_timeout=15000"});await sql.connect();
   assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows,[{db:"notion_import_test",usr:"synthetic",port:56752}]);
   assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory,process.env.PG_NOTION_TEST_DATA_DIRECTORY);
   assert.equal((await sql.query("SELECT pg_try_advisory_lock(84567056752::bigint) AS owned")).rows[0].owned,true);
   for(const t of [...Object.values(tables),"members","team_users","instructor_notes"])assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n),0,`requires empty owned ${t}`);
   owned=true;prisma=(await load<{getPrismaClient():PrismaClient}>("src/lib/data/prisma.ts")).getPrismaClient();
   const fields=await frozen<typeof import("../privacy/fields")>("src/lib/privacy/fields.ts");
   raw=async m=>(await sql!.query(`SELECT * FROM "${tables[m]}" ORDER BY id`)).rows;
   read=async m=>{
    const rows=await raw(m) as Row[];
    for(const row of rows)for(const [field,policy] of Object.entries(fields.privacyFields[m]?.fields??{}))if(policy.indexColumn){const plain=fields.decryptField(m,field,row[policy.column]);assert.equal(row[policy.indexColumn],fields.indexField(m,field,plain),`PG companion ${m}.${field}`);}
    return rows.map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>!k.endsWith("_pii_index")).map(([key,value])=>{const k=key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase());let v=fields.privacyFields[m]?.fields[k]?fields.decryptField(m,k,value):value;const field=Prisma.dmmf.datamodel.models.find(model=>model.name===m)?.fields.find(field=>field.name===k);assert.ok(field,`unknown logical field ${m}.${k}`);if(field.kind==="enum"&&v!==null){assert.equal(typeof v,"string");v=(v as string).toUpperCase();}if(field.type==="Int"&&v!==null)assert.ok(Number.isInteger(v),`integer field ${m}.${k}`);return [k,v];})));
   };
   historical=async(id,type)=>{await sql!.query("UPDATE data_import_runs SET source_type=$2 WHERE id=$1",[id,type]);};
   setRunTime=async(id,at)=>{await sql!.query("UPDATE data_import_runs SET started_at=$2 WHERE id=$1",[id,at]);};
   for(const role of ["OM","LD"] as const)await prisma.teamUser.create({data:{name:`SYNTHETIC_${role}`,email:`synthetic-${role}@example.invalid`,slackId:`synthetic-${role}`,team:"1팀",role}});
   await prisma.instructorNote.create({data:{instructorName:"SYNTHETIC_KNOWN",displayName:"SYNTHETIC_KNOWN",recruitAvoid:false}});
   // Actual FK-linked sentinel. Captured raw state includes audit-independent ciphertext.
   const company=await prisma.company.create({data:{name:"SYNTHETIC_SENTINEL",normalizedName:"synthetic_sentinel"}});
   const course=await prisma.course.create({data:{companyId:company.id,courseId:"SYNTHETIC_SENTINEL",name:"SYNTHETIC_SENTINEL"}});
   await prisma.operationSession.create({data:{courseRecordId:course.id,operationId:"SYNTHETIC_SENTINEL",startDate:new Date("2030-01-01T00:00:00.000Z"),endDate:new Date("2030-01-02T00:00:00.000Z"),educationDates:[]}});
  }else{
   assert.equal(process.env.MONGODB_NOTION_TEST_URI,MONGO);client=new MongoClient(MONGO,{directConnection:true,serverSelectionTimeoutMS:5000});await client.connect();
   const hello=await client.db("admin").command({hello:1});assert.equal(hello.setName,"notionimport20260930");assert.equal(hello.isWritablePrimary,true);
   dbName=`hub_om_shadow_notion_parity_${randomBytes(8).toString("hex")}`;assert.equal((await client.db(dbName).listCollections().toArray()).length,0);owned=true;
   const options={client,databaseName:dbName,namespace:"shadow_notion_parity",allowShadowWrites:true as const};
   const imp=await import("./mongoImportRepository"),team=await import("./mongoTeamMemberRepository"),notes=await import("./mongoInstructorNoteRepository"),audit=await import("./mongoRequestAuditRepository"),ready=await import("./mongoReadStore");
   await imp.prepareMongoImportStore(options);await ready.prepareMongoReadStore(options,ready.TEAM_READ_MODELS);await ready.prepareMongoReadStore(options,notes.INSTRUCTOR_NOTE_MODELS);await audit.prepareMongoRequestAuditStore(options);
   const {MongoOperationStore,completeMongoRow}=await import("./mongoOperationStore");const codec=await import("./mongoRuntimeCodec");
   const models=[...new Set([...imp.IMPORT_MODELS,...ready.TEAM_READ_MODELS,...notes.INSTRUCTOR_NOTE_MODELS,...audit.REQUEST_AUDIT_MODELS])];const store=new MongoOperationStore(options,models);
   const http=await import("./notionImport");
   scope={imports:await imp.MongoImportRepository.open(options),teamMembers:await team.MongoTeamMemberRepository.open(options),instructorNote:await notes.MongoInstructorNoteRepository.open(options),requestActivity:await audit.MongoRequestAuditRepository.open(options),notionImportSource:{readDatabase:http.readNotionDatabaseImport}};
   const context=await import("./dataRepositoryContext");invoke=fn=>context.runWithDataRepositories(scope!,fn);
   raw=async m=>store.collection(m).find({}).sort({_id:1}).toArray();
   read=async m=>(await raw(m) as Row[]).map(row=>Object.fromEntries(Object.entries(codec.decodeMongoRuntimeDocument(m,row as import("./mongoRuntimeCodec").MongoRuntimeDocument)).filter(([k])=>!k.endsWith("PiiIndex")).map(([k,v])=>[k,v===codec.MongoDbNull||v===codec.MongoJsonNull?null:v])));
   historical=async(id,type)=>{await store.collection("DataImportRun").updateOne({_id:id},{$set:{sourceType:type}});};
   setRunTime=async(id,at)=>{await store.collection("DataImportRun").updateOne({_id:id},{$set:{startedAt:at}});};
   for(const role of ["OM","LD"] as const)await store.collection("TeamUser").insertOne(codec.encodeMongoRuntimeDocument("TeamUser",completeMongoRow("TeamUser",{id:randomUUID(),name:`SYNTHETIC_${role}`,email:`synthetic-${role}@example.invalid`,slackId:`synthetic-${role}`,team:"1팀",role,createdAt:new Date()})));
   await store.collection("InstructorNote").insertOne(codec.encodeMongoRuntimeDocument("InstructorNote",completeMongoRow("InstructorNote",{id:randomUUID(),instructorName:"SYNTHETIC_KNOWN",displayName:"SYNTHETIC_KNOWN",recruitAvoid:false,createdAt:new Date(),updatedAt:new Date()})));
   const co=randomUUID(),cr=randomUUID(),op=randomUUID(),at=new Date("2030-01-01T00:00:00.000Z");
   for(const [m,row] of [["Company",{id:co,name:"SYNTHETIC_SENTINEL",normalizedName:"synthetic_sentinel",createdAt:at,updatedAt:at}],["Course",{id:cr,companyId:co,courseId:"SYNTHETIC_SENTINEL",name:"SYNTHETIC_SENTINEL",operationType:"NEEDS_REVIEW",processSeq:1,createdAt:at,updatedAt:at}],["OperationSession",{id:op,courseRecordId:cr,operationId:"SYNTHETIC_SENTINEL",operationStatus:"ASSIGNMENT_NEEDED",archiveStatus:"NOT_READY",educationFormat:"NEEDS_REVIEW",operationChannel:"NEEDS_REVIEW",onsiteRequired:"UNKNOWN",hasSatisfactionSurvey:"NEEDS_REVIEW",hasResultReport:"NEEDS_REVIEW",startDate:at,endDate:new Date("2030-01-02T00:00:00.000Z"),educationDates:[],createdAt:at,updatedAt:at}]] as Array<[string,Row]>)await store.collection(m).insertOne(codec.encodeMongoRuntimeDocument(m,completeMongoRow(m,row)));
  }
  const sentinel=canonical(await Promise.all((["Company","Course","OperationSession"] as Model[]).map(raw)));
  const changeAudit=canonical(await raw("ActivityChange"));

  const imp=await load<{POST(r:Request):Promise<Response>}>("src/app/api/admin/imports/notion/import/route.ts");
  const factory=await load<{getImportRepository():ImportRepository}>("src/lib/data/importRepositoryFactory.ts");
  const repository=await invoke(async()=>factory.getImportRepository());
  const summariesExpected=new Map<string,Row>();
  const checkedIds=expectedIds();
  for(const model of ["DataImportRun","OperationSourceRecord","ActivityRequest"] as const)assert.equal((await read(model)).length,0,"identity oracle requires empty initial business/request collections");
  type Observation={response:Response;before:number;after:number;audit:Row};
  async function request(body:Row):Promise<Observation>{
   const before=Date.now();
   const response=await invoke(()=>imp.POST(new Request("http://synthetic.invalid/api/admin/imports/notion/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({databaseUrl:DATABASE,sourceTeam:"team_1",...body})})));
   const after=Date.now(),requestId=response.headers.get("X-Request-Id");assert.ok(requestId);registerId(checkedIds.audits,requestId,"request audit");
   const matches=(await read("ActivityRequest")).filter(row=>row.id===requestId);assert.equal(matches.length,1);const audit=matches[0];
   assert.ok(audit.occurredAt instanceof Date);assert.ok(audit.occurredAt.getTime()>=before-2&&audit.occurredAt.getTime()<=after+2);
   assert.ok(Number.isInteger(audit.durationMs)&&Number(audit.durationMs)>=0);
   assert.deepEqual(audit,{id:requestId,occurredAt:audit.occurredAt,actorEmail:EMAIL,actorName:"Synthetic Parity",actorType:"user",route:"/api/admin/imports/notion/import",method:"POST",status:response.status,durationMs:audit.durationMs});
   return {response,before,after,audit};
  }
  async function unchanged(){assert.equal(canonical(await Promise.all((["Company","Course","OperationSession"] as Model[]).map(raw))),sentinel);assert.equal(canonical(await raw("ActivityChange")),changeAudit);}
  // Store indices and duplicate indices are explicit fixture expectations, never inferred from the product or ledger.
  async function check(name:string,input:LiteralPage[],storedIndices:number[],duplicateIndices:number[],body:Row={},observed?:Observation,sourceName=name,twoPages=false){
   if(!observed)configure(input,twoPages);
   const observation=observed??await request({sourceName,...body});const {response,before,after,audit}=observation;
   if(!observed)assert.equal(fetchCalls.length,transportPages.length);
   const json=await response.json() as Row;assert.equal(response.status,200);
   const id=String(json.importRunId);assert.match(id,/^[0-9a-f-]{36}$/);
   const errors=storedIndices.filter(i=>input[i].errors.length>0).length+duplicateIndices.length;
   const successes=storedIndices.length-(errors-duplicateIndices.length);
   const logs=[...storedIndices.filter(i=>input[i].errors.length>0).map(i=>({rowNumber:i+2,errors:input[i].errors})),...duplicateIndices.map(i=>({rowNumber:i+2,errors:[DUP]}))];
   assert.deepEqual(json,{ok:true,duplicateCount:duplicateIndices.length,errorCount:errors,importRunId:id,rowCount:input.length,storedCount:storedIndices.length});
   registerId(checkedIds.runs,id,"import run");
   const runs=(await read("DataImportRun")).filter(row=>row.id===id);assert.equal(runs.length,1);const run=runs[0];
   for(const key of ["startedAt","finishedAt"]){assert.ok(run[key] instanceof Date);assert.ok((run[key] as Date).getTime()>=before-2&&(run[key] as Date).getTime()<=after+2);}
   const sourceTeam=body.sourceTeam??"team_1",team=sourceTeam==="team_2"||sourceTeam==="2팀"?"TEAM_2":sourceTeam==="team_1"||sourceTeam==="1팀"?"TEAM_1":"UNKNOWN",label=team==="TEAM_1"?"1팀":team==="TEAM_2"?"2팀":"미확인";
   assert.deepEqual(run,{id,sourceTeam:team,sourceType:"notion",sourceName,workbookName:DATABASE,fileName:null,status:errors?"COMPLETED_WITH_ERRORS":"COMPLETED",rowCount:input.length,successCount:successes,errorCount:errors,importedBy:EMAIL,startedAt:run.startedAt,finishedAt:run.finishedAt,notes:null,validationLogs:logs});
   const rows=(await read("OperationSourceRecord")).filter(row=>row.importRunId===id).sort((a,b)=>Number(a.sourceRowNumber)-Number(b.sourceRowNumber));
   assert.equal(rows.length,storedIndices.length);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
   for(const [j,row] of rows.entries()){
    const i=storedIndices[j],literal=input[i];assert.ok(row.createdAt instanceof Date);assert.ok(row.createdAt.getTime()>=before-2&&row.createdAt.getTime()<=after+2);
    assert.deepEqual(row,{id:row.id,importRunId:id,operationSessionId:null,sourceTeam:team,sourceWorkbook:DATABASE,sourceSheet:"Notion",sourceRowNumber:i+2,headerRowNumber:1,sourceFingerprint:fingerprint(literal),rowSnapshot:literal.snapshot,mappedFields:literal.fields,unmappedFields:{},validationErrors:literal.errors,createdAt:row.createdAt});
   }
   for(const row of rows)registerRow(checkedIds,String(row.id),id);
   const summary={id,sourceTeam:label,sourceType:"notion",status:errors?"오류있음":"완료",rowCount:input.length,successCount:successes,errorCount:errors,sourceRecordCount:storedIndices.length,importedBy:EMAIL,startedAt:dateText(run.startedAt as Date),finishedAt:dateText(run.finishedAt as Date),notes:"",fileName:sourceName,validationLogCount:logs.length};summariesExpected.set(id,summary);
   const expectedDetail={...summary,records:rows.slice(0,200).map((row,j)=>record(input[storedIndices[j]],String(row.id),row.createdAt as Date,label,storedIndices[j]+2))};
   const detail=await invoke(()=>repository.getImportRunById(id));assert.deepEqual(detail,expectedDetail);assert.ok(detail);
   if(name==="boundary201"){
    assert.equal(rows.length,201);assert.equal(detail.records.length,200);
    const last=record(input[storedIndices[200]],String(rows[200].id),rows[200].createdAt as Date,label,storedIndices[200]+2) as unknown as typeof detail.records[number];
    assert.ok(!detail.records.some(r=>r.id===last.id));
    const removed=structuredClone(detail),added=structuredClone(detail),replaced=structuredClone(detail);
    removed.records.splice(199,1);added.records.push(last);replaced.records[199]=last;
    for(const bad of [removed,added,replaced])assert.throws(()=>assert.deepEqual(bad,expectedDetail));
    await mark("preview201-wholeDTO-three-negative-controls");
   }
   await unchanged();
   const tuple={response:{status:response.status,body:{...json,importRunId:"<run>"},requestId:"<request>"},run:{...run,id:"<run>",startedAt:"<date>",finishedAt:"<date>"},rows:rows.map((row,i)=>({...row,id:`<row:${i}>`,importRunId:"<run>",createdAt:"<date>"})),audit:{...audit,id:"<request>",occurredAt:"<date>",durationMs:"<duration>"},detail:{...detail,id:"<run>",startedAt:"<date>",finishedAt:"<date>",records:detail.records.map((row,i)=>({...row,id:`<row:${i}>`,createdAt:"<date>"}))}};
   if(name==="literal-negative-controls"){
    const bads:unknown[]=[];
    const missing=structuredClone(tuple) as Row;delete missing.audit;bads.push(missing);
    bads.push({...tuple,extra:1});
    const wrong=structuredClone(tuple);(wrong.response.body as Row).ok=false;bads.push(wrong);
    const nullFlip=structuredClone(tuple);(nullFlip.rows[0] as Row).operationSessionId="";bads.push(nullFlip);
    const reverse=structuredClone(tuple);reverse.detail.records.reverse();bads.push(reverse);
    const duplicate=structuredClone(tuple);duplicate.rows.push(duplicate.rows[0]);bads.push(duplicate);
    for(const bad of bads)assert.throws(()=>assert.deepEqual(bad,tuple));
   }
   await mark(name,tuple);return id;
  }
  const indices=(n:number)=>Array.from({length:n},(_,i)=>i);
  await check("normal",[page(0)],[0],[]);
  await check("all-duplicate",[page(0)],[],[0],{},undefined,"normal");
  await check("valid-roster",[page(1,"valid")],[0],[]);
  await check("known-instructor",[page(2,"known")],[0],[]);
  const blankInstructor=page(20);(blankInstructor.raw.properties as Row)["강사"]={type:"rich_text",rich_text:[{plain_text:"   "}]};
  await check("blank-instructor",[blankInstructor],[0],[]);
  await check("unknown-instructor",[page(3,"unknown")],[0],[]);
  await check("date-and-role-errors",[page(4,"invalid")],[0],[]);
  await check("empty-properties-required-fields",[page(5,"empty")],[0],[]);
  await check("literal-negative-controls",[page(6),page(7)],[0,1],[]);
  for(const [name,team] of [["alias-team1","1팀"],["alias-team2","2팀"],["team2","team_2"],["unknown-team","other"]])await check(name,[page(0)],[0],[],{sourceTeam:team});
  await check("source-default",[page(8)],[0],[],{sourceName:undefined},undefined,"Notion 운영 데이터");
  await check("source-whitespace",[page(9)],[0],[],{sourceName:" "},undefined,"Notion 운영 데이터");
  await check("source-trim",[page(10)],[0],[],{sourceName:"  trimmed-source  "},undefined,"trimmed-source");
  await check("same-name-other-team",[page(0)],[0],[],{sourceTeam:"team_2"},undefined,"normal");
  await check("same-row-other-name",[page(0)],[0],[]);
  await check("same-upload-duplicate-pages",[page(11),page(11),page(12)],[0,2],[1],{},undefined,"same-upload-duplicate-pages",true);
  await check("partial-seed",[page(13)],[0],[],{},undefined,"partial-source");
  await check("partial-retry",[page(13),page(14)],[1],[0],{},undefined,"partial-source",true);
  // Same business values and page URL; only original page identity changes.
  const changedIdentity=structuredClone(page(15)),different=page(16);
  changedIdentity.raw.id=different.raw.id;changedIdentity.snapshot["운영ID"]=different.snapshot["운영ID"];changedIdentity.fields.operationId=different.fields.operationId;
  assert.notEqual(fingerprint(page(15)),fingerprint(changedIdentity));
  await check("same-mapped-business-different-page-id",[page(15),changedIdentity],[0,1],[]);
  const historicalId=await check("historical-seed",[page(17)],[0],[],{},undefined,"historical");
  await historical(historicalId,"spreadsheet");summariesExpected.set(historicalId,{...summariesExpected.get(historicalId)!,sourceType:"spreadsheet"});
  await check("historical-other-source-type",[page(17)],[0],[],{},undefined,"historical");
  await check("historical-notion-duplicate",[page(17)],[],[0],{},undefined,"historical");
  const unknownId=await check("historical-unknown-seed",[page(19)],[0],[],{},undefined,"historical-unknown");
  await historical(unknownId,"synthetic-other-source");summariesExpected.set(unknownId,{...summariesExpected.get(unknownId)!,sourceType:"synthetic-other-source"});
  await check("historical-unknown-source-type",[page(19)],[0],[],{},undefined,"historical-unknown");
  for(const n of [199,201])await check(`boundary${n}`,indices(n).map(i=>page(1000+i)),indices(n),[]);
  for(const source of ["local","notion","synthetic-unknown"]){process.env.OPERATION_DATA_SOURCE=source;await check(`default-backend-env-${source}`,[page(18,"valid")],[0],[]);delete process.env.OPERATION_DATA_SOURCE;}
  // Both schedules use identical raw pages/rosters and the very same complete tuple oracle on all three backends.
  const raceRows=[page(50,"valid"),page(51,"known")],raceName="race-overlap";
  configure(raceRows,true);const observed:Observation[]=[];
  const work=async()=>{const o=await request({sourceName:raceName});assert.equal(o.response.status,200);observed.push({...o,response:o.response.clone()});return (await o.response.json() as {importRunId:string}).importRunId;};
  const beforeRaceAudits=(await read("ActivityRequest")).length;
  const {results,traces}=prisma?await bothReadsBeforeCommit(prisma,work):await bothNativeReadsBeforeCommit(raceName,work);
  assert.equal(new Set(results).size,2);assert.equal(observed.length,2);assert.equal(fetchCalls.length,4);
  assert.equal((await read("ActivityRequest")).length,beforeRaceAudits+2);
  for(const o of observed)await check("race-overlap-tuple",raceRows,[0,1],[],{},o,raceName);
  await mark("race-overlap-read-barrier",{traces,requests:2,fetches:4,runCount:2,rowCount:4,audits:2});
  const first=await check("race-sequential-first",raceRows,[0,1],[],{},undefined,"race-sequential",true);
  assert.equal((await read("OperationSourceRecord")).filter(r=>r.importRunId===first).length,2);
  const second=await check("race-sequential-second",raceRows,[],[0,1],{},undefined,"race-sequential",true);assert.notEqual(first,second);
  await mark("race-sequential-commit-barrier",{trace:["first-POST-commit-audit-settled","committed-two-rows-observed","second-source-read"],runCount:2,rowCount:2});
  // Separate raw-error lane. Deliberate current sanitization is not normalized into claimed error equality.
  for(const kind of ["http","transport","json"] as const){
   configure([page(60),page(61)],true);faultAt=1;fault=kind;
   const before=canonical([await raw("DataImportRun"),await raw("OperationSourceRecord")]);const o=await request({sourceName:`late-${kind}`});
   assert.equal(o.response.status,400);const body=await o.response.json() as {ok:boolean;error:string};assert.equal(body.ok,false);assert.equal(fetchCalls.length,2);
   if(backend==="original"){
    if(kind==="http")assert.equal(body.error,"Notion 데이터베이스를 읽지 못했습니다. 500 SYNTHETIC_STATUS_CANARY");
    if(kind==="transport")assert.equal(body.error,"SYNTHETIC_TRANSPORT_CANARY");
    if(kind==="json")assert.match(body.error,/JSON|property name/);
   }else assert.equal(body.error,"Notion 데이터를 가져오지 못했습니다.");
   assert.equal(canonical([await raw("DataImportRun"),await raw("OperationSourceRecord")]),before);await unchanged();await mark(`late-${kind}-no-staging`,"separate-original-raw-current-sanitized-assertions");
  }
  for(const [name,input,body] of [["sourceName-number-normal",[page(62)],{sourceName:123}],["sourceName-number-empty",[],{sourceName:123}]] as Array<[string,LiteralPage[],Row]>){
   configure(input);const before=canonical([await raw("DataImportRun"),await raw("OperationSourceRecord")]);const o=await request(body);assert.equal(o.response.status,400);
   assert.deepEqual(await o.response.json(),{ok:false,error:input.length?(backend==="original"?"body.sourceName?.trim is not a function":"Notion 데이터를 가져오지 못했습니다."):"저장할 Notion 행이 없습니다."});
   assert.equal(fetchCalls.length,1);assert.equal(canonical([await raw("DataImportRun"),await raw("OperationSourceRecord")]),before);await unchanged();await mark(name,"failure-order-no-staging");
  }
  // Verify actual backend order before normalizing IDs. Never sort the returned summaries.
  const tie=new Date("2040-01-01T00:00:00.000Z");for(const id of [...summariesExpected.keys()].slice(0,2)){await setRunTime(id,tie);summariesExpected.set(id,{...summariesExpected.get(id)!,startedAt:dateText(tie)});}
  const summaries=await invoke(()=>repository.listImportRuns()),storedRuns=await read("DataImportRun");
  assert.equal(summaries.length,summariesExpected.size);assert.equal(new Set(summaries.map(r=>r.id)).size,summaries.length);
  for(let i=0;i<summaries.length;i++){
   const summary=summaries[i];assert.deepEqual(summary,summariesExpected.get(summary.id));
   if(i){const a=storedRuns.find(r=>r.id===summaries[i-1].id)!,b=storedRuns.find(r=>r.id===summary.id)!;const x=(a.startedAt as Date).getTime(),y=(b.startedAt as Date).getTime();assert.ok(x>y||(x===y&&String(a.id)>String(b.id)));}
  }
  await mark("summary-real-order-tie-complete-bijection");await unchanged();
  await check("recovery-after-source-failure",[page(63,"valid")],[0],[]);
  const nativeIsolation=backend==="mongo"?await (await import("./notionImportParityIsolation.fixture.ts")).nativeIsolation(client!,imp.POST):undefined;
  const allIds={runs:(await read("DataImportRun")).map(r=>({id:r.id})),rows:(await read("OperationSourceRecord")).map(r=>({id:r.id,importRunId:r.importRunId})),audits:(await read("ActivityRequest")).map(r=>({id:r.id}))};
  assertCompleteIds(allIds,checkedIds);
  const negativeControls=identityNegativeControls(allIds,checkedIds);
  await mark("whole-store-ID-parent-bijection",{runs:checkedIds.runs.size,rows:checkedIds.rows.size,audits:checkedIds.audits.size,negativeControls});
  await send({kind:"result",backend,ledger,nativeIsolation});
 }finally{
  await prisma?.$disconnect();
  if(sql){if(owned){for(const t of ["operation_source_records","data_import_runs","operation_sessions","courses","companies","team_users","instructor_notes","activity_changes","activity_requests"])await sql.query(`DELETE FROM "${t}"`);for(const t of [...Object.values(tables),"team_users","instructor_notes"])assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n),0);await send({kind:"cleanup",backend,remaining:0});}await sql.end();}
  if(client){if(owned){await client.db(dbName).dropDatabase();assert.equal((await client.db(dbName).listCollections().toArray()).length,0);await send({kind:"cleanup",backend,remaining:0});}await client.close();}
 }
}
main().catch(async e=>{await send({kind:"failure",message:e instanceof Error?e.stack:String(e)});process.exitCode=1;});
