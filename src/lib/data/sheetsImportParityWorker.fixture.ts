/** Separate process per backend. Parent executes only. Gate/manifest remain immutable. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { MongoClient } from "mongodb";
import { Prisma, type PrismaClient } from "@prisma/client";
import { frozen,installFrozenResolver,verifyClosure } from "../../../.claude/plans/mongodb-google-sheets-import/original/frozen-loader.fixture.ts";
import { currentAuthSeam } from "./sheetsImportParityLoader.fixture.ts";
import { EMAIL,SHEET,TAB,HEAD,ERRORS,DUP,table,expectedFields,snapshot,fingerprint,expectedRecord,expectedSummary,controls,dateText,type Row } from "./sheetsImportParityLiterals.fixture.ts";
import type { ImportRepository } from "./importRepository";
import { bothReadsBeforeCommit, bothNativeReadsBeforeCommit } from "./sheetsImportParityRace.fixture.ts";
import type { DataRepositories } from "./dataRepositoryContext";
const PG="postgresql://synthetic@127.0.0.1:56751/sheets_import_test",MONGO="mongodb://127.0.0.1:27851/?replicaSet=sheetsimport20260930";
const loadCurrent=<T>(origin:string)=>import(new URL(`../../../${origin}`,import.meta.url).href) as Promise<T>;
async function send(value:unknown){assert.ok(process.send);await new Promise<void>((resolve,reject)=>process.send!(value,e=>e?reject(e):resolve()));}
function canonical(v:unknown):string {if(v instanceof Date)return JSON.stringify(v.toISOString());if(Array.isArray(v))return `[${v.map(canonical).join(',')}]`;if(v&&typeof v==='object')return `{${Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;return JSON.stringify(v)??'null';}
const tables={DataImportRun:"data_import_runs",OperationSourceRecord:"operation_source_records",ActivityRequest:"activity_requests",ActivityChange:"activity_changes",Company:"companies",Course:"courses",OperationSession:"operation_sessions"} as const;
type Model=keyof typeof tables;
async function main(){
 verifyClosure();controls();const backend=process.argv[2];assert.ok(["original","current","mongo"].includes(backend));
 assert.equal(process.env.PG_SHEETS_TEST_DATABASE_URL,PG);assert.equal(process.env.PG_SHEETS_TEST_DATA_DIRECTORY,"/private/tmp/hub-om-google-sheets-import-20260930/pg");
 for(const key of ["DATABASE_URL","DIRECT_URL","PII_ENCRYPTION_KEYS","PII_INDEX_KEY","DEV_AUTH_BYPASS"])assert.equal(process.env[key],undefined);
 Object.assign(process.env,{TZ:"UTC",PII_ACTIVE_KEY_ID:"sheetsparity",PII_ENCRYPTION_KEYS:JSON.stringify({sheetsparity:randomBytes(32).toString("base64")}),PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false"});
 if(backend!=="mongo")process.env.DATABASE_URL=PG;
 const authURL=`data:text/javascript;base64,${Buffer.from(`export async function auth(){return {user:{email:${JSON.stringify(EMAIL)},name:"Synthetic Parity"},googleAccessToken:"SYNTHETIC_TOKEN",expires:""};}`).toString("base64")}`;
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
 let transportPayload:unknown={values:[]};let transportStatus=200;let transportError:Error|undefined;
 const fetchCalls:Array<{url:string;options:unknown}>=[];
 globalThis.fetch=async(input,options)=>{const url=String(input);assert.ok(url.startsWith(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`),"EXTERNAL_FETCH_FORBIDDEN");fetchCalls.push({url,options});if(transportError)throw transportError;return new Response(JSON.stringify(transportPayload),{status:transportStatus,headers:{"content-type":"application/json"}});};
 try{
  if(backend!=="mongo"){
   sql=new pg.Client({connectionString:PG,connectionTimeoutMillis:5000,query_timeout:15000,options:"-c timezone=UTC -c statement_timeout=15000"});await sql.connect();
   assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows,[{db:"sheets_import_test",usr:"synthetic",port:56751}]);
   assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory,process.env.PG_SHEETS_TEST_DATA_DIRECTORY);
   assert.equal((await sql.query("SELECT pg_try_advisory_lock(84567056751::bigint) AS owned")).rows[0].owned,true);
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
   assert.equal(process.env.MONGODB_SHEETS_TEST_URI,MONGO);client=new MongoClient(MONGO,{directConnection:true,serverSelectionTimeoutMS:5000});await client.connect();
   const hello=await client.db("admin").command({hello:1});assert.equal(hello.setName,"sheetsimport20260930");assert.equal(hello.isWritablePrimary,true);
   dbName=`hub_om_shadow_sheets_parity_${randomBytes(8).toString("hex")}`;assert.equal((await client.db(dbName).listCollections().toArray()).length,0);owned=true;
   const options={client,databaseName:dbName,namespace:"shadow_sheets_parity",allowShadowWrites:true as const};
   const imp=await import("./mongoImportRepository"),team=await import("./mongoTeamMemberRepository"),notes=await import("./mongoInstructorNoteRepository"),audit=await import("./mongoRequestAuditRepository"),ready=await import("./mongoReadStore");
   await imp.prepareMongoImportStore(options);await ready.prepareMongoReadStore(options,ready.TEAM_READ_MODELS);await ready.prepareMongoReadStore(options,notes.INSTRUCTOR_NOTE_MODELS);await audit.prepareMongoRequestAuditStore(options);
   const {MongoOperationStore,completeMongoRow}=await import("./mongoOperationStore");const codec=await import("./mongoRuntimeCodec");
   const models=[...new Set([...imp.IMPORT_MODELS,...ready.TEAM_READ_MODELS,...notes.INSTRUCTOR_NOTE_MODELS,...audit.REQUEST_AUDIT_MODELS])];const store=new MongoOperationStore(options,models);
   const http=await import("./googleSheetsImport");
   scope={imports:await imp.MongoImportRepository.open(options),teamMembers:await team.MongoTeamMemberRepository.open(options),instructorNote:await notes.MongoInstructorNoteRepository.open(options),requestActivity:await audit.MongoRequestAuditRepository.open(options),googleSheetsImportSource:{listTabs:http.listGoogleSheetTabs,readRows:http.readGoogleSheetRows}};
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
  const tabs=await load<{POST(r:Request):Promise<Response>}>("src/app/api/admin/imports/google-sheets/tabs/route.ts"),imp=await load<{POST(r:Request):Promise<Response>}>("src/app/api/admin/imports/google-sheets/import/route.ts");
  const factory=await load<{getImportRepository():ImportRepository}>("src/lib/data/importRepositoryFactory.ts");
  const repository=await invoke(async()=>factory.getImportRepository());
  async function request(body:Row,action="import"){
   const before=Date.now();
   const response=await invoke(()=>(action==="tabs"?tabs:imp).POST(new Request(`http://synthetic.invalid/api/admin/imports/google-sheets/${action}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({spreadsheetUrl:`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=0`,tabTitle:TAB,sourceTeam:"team_1",...body})})));
   const after=Date.now(),requestId=response.headers.get("X-Request-Id");assert.ok(requestId);
   const audits=(await read("ActivityRequest")).filter(r=>r.id===requestId);assert.equal(audits.length,1);const audit=audits[0];
   assert.ok(audit.occurredAt instanceof Date);assert.ok(audit.occurredAt.getTime()>=before-2&&audit.occurredAt.getTime()<=after+2);
   assert.ok(Number.isInteger(audit.durationMs)&&Number(audit.durationMs)>=0);
   assert.deepEqual(audit,{id:requestId,occurredAt:audit.occurredAt,actorEmail:EMAIL,actorName:"Synthetic Parity",actorType:"user",route:`/api/admin/imports/google-sheets/${action}`,method:"POST",status:response.status,durationMs:audit.durationMs});
   return response;
  }
  const expectedSummaries=new Map<string,Row>();
  async function normal(name:string,n:number,body:Row={},duplicate=false,observed?:{response:Response;before:number;after:number}){
   transportPayload={values:table(n)};fetchCalls.length=0;
   const before=observed?.before??Date.now(),response=observed?.response??await request({sourceName:name,...body}),after=observed?.after??Date.now(),json=await response.json() as Row;
   assert.equal(response.status,200);const id=String(json.importRunId);assert.match(id,/^[0-9a-f-]{36}$/);
   assert.deepEqual(json,{ok:true,duplicateCount:duplicate?n:0,errorCount:n,headerRowNumber:1,importRunId:id,rowCount:n,storedCount:duplicate?0:n});
   if(!observed){assert.equal(fetchCalls.length,1);assert.deepEqual(fetchCalls[0],{url:`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/'Synthetic%20''%20Tab'!A1%3AZZ2000?majorDimension=ROWS`,options:{headers:{authorization:"Bearer SYNTHETIC_TOKEN"}}});}
   const run=(await read("DataImportRun")).find(r=>r.id===id)!;assert.ok(run);
   for(const key of ["startedAt","finishedAt"]){assert.ok(run[key] instanceof Date);assert.ok((run[key] as Date).getTime()>=before-2 && (run[key] as Date).getTime()<=after+2);}
   const sourceTeam=body.sourceTeam??"team_1",team=sourceTeam==="team_2"||sourceTeam==="2팀"?"TEAM_2":sourceTeam==="team_1"||sourceTeam==="1팀"?"TEAM_1":"UNKNOWN",label=team==="TEAM_2"?"2팀":team==="TEAM_1"?"1팀":"미확인";
   assert.deepEqual(run,{id,sourceTeam:team,sourceType:"spreadsheet",sourceName:name,workbookName:SHEET,fileName:null,status:"COMPLETED_WITH_ERRORS",rowCount:n,successCount:0,errorCount:n,importedBy:EMAIL,startedAt:run.startedAt,finishedAt:run.finishedAt,notes:null,validationLogs:Array.from({length:n},(_,i)=>({rowNumber:i+2,errors:duplicate?[DUP]:ERRORS}))});
   const rows=(await read("OperationSourceRecord")).filter(r=>r.importRunId===id).sort((a,b)=>Number(a.sourceRowNumber)-Number(b.sourceRowNumber));assert.equal(rows.length,duplicate?0:n);
   for(const [i,row] of rows.entries()){
    assert.ok(row.createdAt instanceof Date);assert.ok((row.createdAt as Date).getTime()>=before-2&&(row.createdAt as Date).getTime()<=after+2);
    assert.deepEqual(row,{id:row.id,importRunId:id,operationSessionId:null,sourceTeam:team,sourceWorkbook:SHEET,sourceSheet:TAB,sourceRowNumber:i+2,headerRowNumber:1,sourceFingerprint:fingerprint(i),rowSnapshot:snapshot(i),mappedFields:expectedFields(i),unmappedFields:{"미매핑":"SYNTHETIC_EXTRA"},validationErrors:ERRORS,createdAt:row.createdAt});
   }
   const summary=expectedSummary({id,sourceTeam:label,sourceName:name,rowCount:n,startedAt:run.startedAt,finishedAt:run.finishedAt},rows.length);expectedSummaries.set(id,summary);
   const expectedDetail={...summary,records:rows.slice(0,200).map((row,i)=>expectedRecord(i,String(row.id),row.createdAt as Date,label))};
   const detail=await invoke(()=>repository.getImportRunById(id));assert.deepEqual(detail,expectedDetail);
   if(n===201&&!duplicate){
    assert.ok(detail);assert.equal(detail.records.length,200);assert.ok(!detail.records.some(r=>r.sourceFingerprint===fingerprint(200)));
    const last=expectedRecord(200,String(rows[200].id),rows[200].createdAt as Date,label) as unknown as typeof detail.records[number];
    const removed=structuredClone(detail),added=structuredClone(detail),replaced=structuredClone(detail);
    removed.records.splice(199,1);added.records.push(last);replaced.records[199]=last;
    for(const bad of [removed,added,replaced])assert.throws(()=>assert.deepEqual(bad,expectedDetail));
    assert.deepEqual(detail,expectedDetail);await mark("preview201-wholeDTO-three-negative-controls");
   }
   const reqId=response.headers.get("X-Request-Id");assert.ok(reqId);const audit=(await read("ActivityRequest")).find(r=>r.id===reqId)!;assert.ok(audit);assert.deepEqual(audit,{id:reqId,occurredAt:audit.occurredAt,actorEmail:EMAIL,actorName:"Synthetic Parity",actorType:"user",route:"/api/admin/imports/google-sheets/import",method:"POST",status:200,durationMs:audit.durationMs});assert.ok(Number.isInteger(audit.durationMs)&&Number(audit.durationMs)>=0);
   assert.equal(canonical(await Promise.all((["Company","Course","OperationSession"] as Model[]).map(raw))),sentinel);assert.equal(canonical(await raw("ActivityChange")),changeAudit);
   await mark(`${name}-${duplicate?"duplicate":"stored"}`,{body:{...json,importRunId:"<run>"},run:{...run,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>"},audit:{...audit,id:"<request>",occurredAt:"<observed-date>",durationMs:"<observed-duration>"},rows:rows.map((row,i)=>({...row,id:`<row:${i}>`,importRunId:"<run>",createdAt:"<observed-date>"})),summary:{...summary,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>"},detail:detail!.records.map((row,i)=>({...row,id:`<row:${i}>`,createdAt:"<observed-date>"}))});return id;
  }
  await normal("normal",1);await normal("normal",1,{},true);await normal("boundary199",199);await normal("boundary201",201);await normal("normal",1,{sourceTeam:"team_2"});await normal("unknown-team",1,{sourceTeam:"unknown"});await normal(TAB,1,{sourceName:"   "});await normal("header-zero",1,{headerRowNumber:0});await normal("header-negative",1,{headerRowNumber:-1});await normal("alias-team1",1,{sourceTeam:"1팀"});await normal("alias-team2",1,{sourceTeam:"2팀"});await normal("trimmed-source",1,{sourceName:"  trimmed-source  "});
  const historicalId=await normal("historical",1);await historical(historicalId,"notion");expectedSummaries.set(historicalId,{...expectedSummaries.get(historicalId)!,sourceType:"notion"});await normal("historical",1);await normal("historical",1,{},true);
  // Duplicate within one source response retains first physical row; duplicate log follows stored errors.
  transportPayload={values:[HEAD,table(2)[1],table(2)[1],table(2)[2]]};
  const duBefore=Date.now(),duRes=await request({sourceName:"within-upload"}),duAfter=Date.now(),duBody=await duRes.json() as Row;const duId=String(duBody.importRunId);
  assert.equal(duRes.status,200);assert.deepEqual(duBody,{ok:true,duplicateCount:1,errorCount:3,headerRowNumber:1,importRunId:duId,rowCount:3,storedCount:2});
  const duRun=(await read("DataImportRun")).find(r=>r.id===duId)!,duRows=(await read("OperationSourceRecord")).filter(r=>r.importRunId===duId).sort((a,b)=>Number(a.sourceRowNumber)-Number(b.sourceRowNumber));assert.equal(duRows.length,2);
  assert.deepEqual(duRun,{id:duId,sourceTeam:"TEAM_1",sourceType:"spreadsheet",sourceName:"within-upload",workbookName:SHEET,fileName:null,status:"COMPLETED_WITH_ERRORS",rowCount:3,successCount:0,errorCount:3,importedBy:EMAIL,startedAt:duRun.startedAt,finishedAt:duRun.finishedAt,notes:null,validationLogs:[{rowNumber:2,errors:ERRORS},{rowNumber:4,errors:ERRORS},{rowNumber:3,errors:[DUP]}]});
  for(const [i,row] of duRows.entries())assert.deepEqual(row,{id:row.id,importRunId:duId,operationSessionId:null,sourceTeam:"TEAM_1",sourceWorkbook:SHEET,sourceSheet:TAB,sourceRowNumber:i===0?2:4,headerRowNumber:1,sourceFingerprint:fingerprint(i),rowSnapshot:snapshot(i),mappedFields:expectedFields(i),unmappedFields:{"미매핑":"SYNTHETIC_EXTRA"},validationErrors:ERRORS,createdAt:row.createdAt});
  for(const value of [duRun.startedAt,duRun.finishedAt,...duRows.map(r=>r.createdAt)]){assert.ok(value instanceof Date);assert.ok(value.getTime()>=duBefore-2&&value.getTime()<=duAfter+2);}
  const duSummary=expectedSummary({id:duId,sourceTeam:"1팀",sourceName:"within-upload",rowCount:3,startedAt:duRun.startedAt,finishedAt:duRun.finishedAt},2);expectedSummaries.set(duId,duSummary);
  const duDetail={...duSummary,records:duRows.map((r,i)=>expectedRecord(i,String(r.id),r.createdAt as Date,"1팀",i===0?2:4))};assert.deepEqual(await invoke(()=>repository.getImportRunById(duId)),duDetail);
  await mark("within-upload-physical-row-whole-tuple",{body:{...duBody,importRunId:"<run>"},run:{...duRun,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>"},records:duDetail.records.map((r,i)=>({...r,id:`<row:${i}>`,createdAt:"<observed-date>"}))});
  // Additional V5 cases execute the same actual handler on all three backends.
  // Fixture positions/errors are literal; product parsing/presentation is never used to build expected.
  async function special(name:string,inputRows:unknown[],header:number,total:number,specs:Array<{index:number;physical:number;instructor?:string;errors:string[]}>,duplicateRows:number[]=[]){
   transportPayload={values:inputRows};fetchCalls.length=0;
   const before=Date.now(),response=await request({sourceName:name}),after=Date.now(),body=await response.json() as Row,id=String(body.importRunId);
   const errorCount=specs.filter(s=>s.errors.length>0).length+duplicateRows.length;
   assert.equal(response.status,200);assert.equal(fetchCalls.length,1);
   assert.deepEqual(body,{ok:true,duplicateCount:duplicateRows.length,errorCount,headerRowNumber:header,importRunId:id,rowCount:total,storedCount:specs.length});
   const run=(await read("DataImportRun")).find(r=>r.id===id)!;
   const logs=[...specs.filter(s=>s.errors.length).map(s=>({rowNumber:s.physical,errors:s.errors})),...duplicateRows.map(rowNumber=>({rowNumber,errors:[DUP]}))];
   const expectedRun={id,sourceTeam:"TEAM_1",sourceType:"spreadsheet",sourceName:name,workbookName:SHEET,fileName:null,status:errorCount?"COMPLETED_WITH_ERRORS":"COMPLETED",rowCount:total,successCount:specs.filter(s=>s.errors.length===0).length,errorCount,importedBy:EMAIL,startedAt:run.startedAt,finishedAt:run.finishedAt,notes:null,validationLogs:logs};
   assert.deepEqual(run,expectedRun);
   const rows=(await read("OperationSourceRecord")).filter(r=>r.importRunId===id).sort((a,b)=>Number(a.sourceRowNumber)-Number(b.sourceRowNumber));assert.equal(rows.length,specs.length);
   const expectedRecords:Row[]=[];
   for(const [position,spec] of specs.entries()){
    const row=rows[position],snap:Record<string,string>={...snapshot(spec.index)};
    if(spec.instructor!==undefined)snap["강사"]=spec.instructor;
    const fp=createHash("sha256").update(JSON.stringify(Object.keys(snap).sort().map(k=>[k,snap[k]]))).digest("hex");
    const fields:Row={...expectedFields(spec.index)};if(spec.instructor!==undefined)fields.instructors=spec.instructor;
    assert.deepEqual(row,{id:row.id,importRunId:id,operationSessionId:null,sourceTeam:"TEAM_1",sourceWorkbook:SHEET,sourceSheet:TAB,sourceRowNumber:spec.physical,headerRowNumber:header,sourceFingerprint:fp,rowSnapshot:snap,mappedFields:fields,unmappedFields:{"미매핑":"SYNTHETIC_EXTRA"},validationErrors:spec.errors,createdAt:row.createdAt});
    const rec=expectedRecord(spec.index,String(row.id),row.createdAt as Date,"1팀",spec.physical);
    rec.headerRowNumber=header;rec.sourceFingerprint=fp;rec.validationErrors=spec.errors;
    if(spec.instructor!==undefined){
     rec.mappedFieldCount=5;
     const mapped=rec.mappedFields as Row[];mapped.splice(3,0,{key:"instructors",label:"강사",value:spec.instructor});
     (rec.rowSnapshotPreview as Row[]).push({key:"강사",label:"강사",value:spec.instructor});
    }
    expectedRecords.push(rec);
   }
   for(const value of [run.startedAt,run.finishedAt,...rows.map(r=>r.createdAt)]){assert.ok(value instanceof Date);assert.ok(value.getTime()>=before-2&&value.getTime()<=after+2);}
   const summary={...expectedSummary({id,sourceTeam:"1팀",sourceName:name,rowCount:total,startedAt:run.startedAt,finishedAt:run.finishedAt},specs.length),status:errorCount?"오류있음":"완료",successCount:specs.filter(s=>s.errors.length===0).length,errorCount,validationLogCount:logs.length};expectedSummaries.set(id,summary);
   const expectedDetail={...summary,records:expectedRecords};assert.deepEqual(await invoke(()=>repository.getImportRunById(id)),expectedDetail);
   assert.equal(canonical([await raw("Company"),await raw("Course"),await raw("OperationSession")]),sentinel);assert.equal(canonical(await raw("ActivityChange")),changeAudit);
   await mark(`${name}-whole-tuple`,{body:{...body,importRunId:"<run>"},run:{...run,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>"},rows:rows.map((r,i)=>({...r,id:`<row:${i}>`,importRunId:"<run>",createdAt:"<observed-date>"})),detail:{...summary,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>",records:expectedRecords.map((r,i)=>({...r,id:`<row:${i}>`,createdAt:"<observed-date>"}))}});
  }
  await special("known-instructor",[[...HEAD,"강사"],[...table(1)[1],"SYNTHETIC_KNOWN"]],1,1,[{index:0,physical:2,instructor:"SYNTHETIC_KNOWN",errors:ERRORS}]);
  await special("unknown-instructor",[[...HEAD,"강사"],[...table(1)[1],"SYNTHETIC_UNKNOWN"]],1,1,[{index:0,physical:2,instructor:"SYNTHETIC_UNKNOWN",errors:[...ERRORS,"강사에 강사DB 노션에 없는 이름이 있습니다: SYNTHETIC_UNKNOWN"]}]);
  await special("notice-blank-physical",[["SYNTHETIC_NOTICE"],[],HEAD,table(2)[1],[],table(2)[2]],3,2,[{index:0,physical:4,errors:ERRORS},{index:1,physical:6,errors:ERRORS}]);
  await normal("partial-retry",1);
  await special("partial-retry",table(2),1,2,[{index:1,physical:3,errors:ERRORS}],[2]);
  // Year fixtures have distinct sourceName: no prior raw fingerprint can hide conversion.
  for(const year of [1999,2000,2100,2101,2032.5,"2032"]){
   transportPayload={values:[["기업명","과정명","시작일"],["SYNTHETIC_C","SYNTHETIC_N","2/3"]]};const yearBefore=Date.now(),res=await request({sourceName:`year-${typeof year}-${year}`,importYear:year}),yearAfter=Date.now();const body=await res.json() as Row;assert.equal(res.status,200);assert.equal(body.storedCount,1);assert.equal(body.duplicateCount,0);
   const rows=(await read("OperationSourceRecord")).filter(r=>r.importRunId===body.importRunId);assert.equal(rows.length,1);assert.deepEqual(rows[0].mappedFields,{companyName:"SYNTHETIC_C",courseName:"SYNTHETIC_N",startDate:year===2000?"2000-02-03":year===2100?"2100-02-03":"2/3"});
   const id=String(body.importRunId),row=rows[0],sourceName=`year-${typeof year}-${year}`,run=(await read("DataImportRun")).find(r=>r.id===id)!;
   for(const value of [run.startedAt,run.finishedAt,row.createdAt]){assert.ok(value instanceof Date);assert.ok(value.getTime()>=yearBefore-2&&value.getTime()<=yearAfter+2);}
   assert.deepEqual(body,{ok:true,duplicateCount:0,errorCount:1,headerRowNumber:1,importRunId:id,rowCount:1,storedCount:1});
   const snap={"기업명":"SYNTHETIC_C","과정명":"SYNTHETIC_N","시작일":"2/3"};
   const fp=createHash("sha256").update(JSON.stringify([["과정명","SYNTHETIC_N"],["기업명","SYNTHETIC_C"],["시작일","2/3"]])).digest("hex");
   const mapped={companyName:"SYNTHETIC_C",courseName:"SYNTHETIC_N",startDate:year===2000?"2000-02-03":year===2100?"2100-02-03":"2/3"};
   assert.deepEqual(row,{id:row.id,importRunId:id,operationSessionId:null,sourceTeam:"TEAM_1",sourceWorkbook:SHEET,sourceSheet:TAB,sourceRowNumber:2,headerRowNumber:1,sourceFingerprint:fp,rowSnapshot:snap,mappedFields:mapped,unmappedFields:{},validationErrors:ERRORS,createdAt:row.createdAt});
   assert.deepEqual(run,{id,sourceTeam:"TEAM_1",sourceType:"spreadsheet",sourceName,workbookName:SHEET,fileName:null,status:"COMPLETED_WITH_ERRORS",rowCount:1,successCount:0,errorCount:1,importedBy:EMAIL,startedAt:run.startedAt,finishedAt:run.finishedAt,notes:null,validationLogs:[{rowNumber:2,errors:ERRORS}]});
   const summary=expectedSummary({id,sourceTeam:"1팀",sourceName,rowCount:1,startedAt:run.startedAt,finishedAt:run.finishedAt},1);expectedSummaries.set(id,summary);
   const record={id:row.id,sourceTeam:"1팀",sourceRowNumber:2,headerRowNumber:1,sourceFingerprint:fp,linkedOperationId:"",linkedOperation:null,mappedFieldCount:3,mappedFields:[{key:"companyName",label:"기업명",value:"SYNTHETIC_C"},{key:"courseName",label:"과정명",value:"SYNTHETIC_N"},{key:"startDate",label:"시작일",value:mapped.startDate}],unmappedFieldCount:0,unmappedFields:[],rowSnapshotPreview:[{key:"기업명",label:"기업명",value:"SYNTHETIC_C"},{key:"과정명",label:"과정명",value:"SYNTHETIC_N"},{key:"시작일",label:"시작일",value:"2/3"}],missingRequiredFields:year===2000||year===2100?["종료일"]:["시작일(형식 확인)","종료일"],reviewStatus:"확인 필요",validationErrors:ERRORS,createdAt:dateText(row.createdAt as Date)};
   assert.deepEqual(await invoke(()=>repository.getImportRunById(id)),{...summary,records:[record]});
   await mark(`year-${typeof year}-${year}`,{body:{...body,importRunId:"<run>"},row:{...row,id:"<row>",importRunId:"<run>",createdAt:"<observed-date>"},summary:{...summary,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>"},record:{...record,id:"<row>",createdAt:"<observed-date>"}});
  }
  // A truly valid roster-backed row: not only COMPLETED_WITH_ERRORS fixtures.
  transportPayload={values:[[...HEAD,"담당OM","담당LD"],[...table(1)[1],"SYNTHETIC_OM","SYNTHETIC_LD"]]};
  const validBefore=Date.now(),validResponse=await request({sourceName:"valid-roster"}),validAfter=Date.now(),validBody=await validResponse.json() as Row;
  assert.equal(validResponse.status,200);const validId=String(validBody.importRunId);assert.deepEqual(validBody,{ok:true,duplicateCount:0,errorCount:0,headerRowNumber:1,importRunId:validId,rowCount:1,storedCount:1});
  const vr=(await read("DataImportRun")).find(r=>r.id===validId)!,vrows=(await read("OperationSourceRecord")).filter(r=>r.importRunId===validId);assert.equal(vrows.length,1);const row=vrows[0];
  for(const value of [vr.startedAt,vr.finishedAt,row.createdAt]){assert.ok(value instanceof Date);assert.ok(value.getTime()>=validBefore-2&&value.getTime()<=validAfter+2);}
  const vsnap={...snapshot(0),"담당OM":"SYNTHETIC_OM","담당LD":"SYNTHETIC_LD"};const vfp=createHash("sha256").update(JSON.stringify(Object.keys(vsnap).sort().map(k=>[k,vsnap[k as keyof typeof vsnap]]))).digest("hex");
  assert.deepEqual(vr,{id:validId,sourceTeam:"TEAM_1",sourceType:"spreadsheet",sourceName:"valid-roster",workbookName:SHEET,fileName:null,status:"COMPLETED",rowCount:1,successCount:1,errorCount:0,importedBy:EMAIL,startedAt:vr.startedAt,finishedAt:vr.finishedAt,notes:null,validationLogs:[]});
  assert.deepEqual(row,{id:row.id,importRunId:validId,operationSessionId:null,sourceTeam:"TEAM_1",sourceWorkbook:SHEET,sourceSheet:TAB,sourceRowNumber:2,headerRowNumber:1,sourceFingerprint:vfp,rowSnapshot:vsnap,mappedFields:{companyName:"SYNTHETIC_COMPANY",courseName:"SYNTHETIC_COURSE_000",endDate:"2032-02-04",ld:"SYNTHETIC_LD",om:"SYNTHETIC_OM",startDate:"2032-02-03"},unmappedFields:{"미매핑":"SYNTHETIC_EXTRA"},validationErrors:[],createdAt:row.createdAt});
  const vs={...expectedSummary({id:validId,sourceTeam:"1팀",sourceName:"valid-roster",rowCount:1,startedAt:vr.startedAt,finishedAt:vr.finishedAt},1),status:"완료",successCount:1,errorCount:0,validationLogCount:0};expectedSummaries.set(validId,vs);
  const base=expectedRecord(0,String(row.id),row.createdAt as Date);
  const vrecord={...base,sourceFingerprint:vfp,mappedFieldCount:6,mappedFields:[{key:"companyName",label:"기업명",value:"SYNTHETIC_COMPANY"},{key:"courseName",label:"과정명",value:"SYNTHETIC_COURSE_000"},{key:"endDate",label:"종료일",value:"2032-02-04"},{key:"ld",label:"LD",value:"SYNTHETIC_LD"},{key:"om",label:"OM",value:"SYNTHETIC_OM"},{key:"startDate",label:"시작일",value:"2032-02-03"}],rowSnapshotPreview:[...(base.rowSnapshotPreview as Row[]),{key:"담당OM",label:"담당OM",value:"SYNTHETIC_OM"},{key:"담당LD",label:"담당LD",value:"SYNTHETIC_LD"}],validationErrors:[],reviewStatus:"적용 준비"};
  assert.deepEqual(await invoke(()=>repository.getImportRunById(validId)),{...vs,records:[vrecord]});
  await mark("valid-roster-whole-tuple",{body:{...validBody,importRunId:"<run>"},run:{...vr,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>"},row:{...row,id:"<row>",importRunId:"<run>",createdAt:"<observed-date>"},detail:{...vs,id:"<run>",startedAt:"<observed-date>",finishedAt:"<observed-date>",records:[{...vrecord,id:"<row>",createdAt:"<observed-date>"}]}});
  // Actual ordering is asserted before identity normalization; no sorting of returned array.
  const tie=new Date("2040-01-01T00:00:00.000Z");const ids=[...expectedSummaries.keys()].slice(0,2);for(const id of ids){await setRunTime(id,tie);expectedSummaries.set(id,{...expectedSummaries.get(id)!,startedAt:dateText(tie)});}
  const summaries=await invoke(()=>repository.listImportRuns()),storedRuns=await read("DataImportRun");
  for(let i=1;i<summaries.length;i++){const prev=storedRuns.find(r=>r.id===summaries[i-1].id)!,next=storedRuns.find(r=>r.id===summaries[i].id)!;const a=(prev.startedAt as Date).getTime(),b=(next.startedAt as Date).getTime();assert.ok(a>b||(a===b&&String(prev.id)>String(next.id)));}
  assert.equal(summaries.length,expectedSummaries.size);assert.equal(new Set(summaries.map(r=>r.id)).size,summaries.length);
  for(const s of summaries){const e=expectedSummaries.get(s.id);assert.ok(e,"unexpected summary identity");assert.deepEqual(s,e);}
  await mark("actual-summary-order-and-complete-bijection");
  // Raw adapter through actual tabs handler, original order intentionally differs from index order.
  transportPayload={sheets:[{properties:{sheetId:2,title:"Second",index:9}},{properties:{sheetId:0,title:"",index:0}},{properties:{sheetId:"bad",title:"skip"}}]};fetchCalls.length=0;
  const tabRes=await request({},"tabs");assert.equal(tabRes.status,200);assert.deepEqual(await tabRes.json(),{ok:true,selectedGid:0,spreadsheetId:SHEET,tabs:[{gid:2,title:"Second"},{gid:0,title:""}]});assert.deepEqual(fetchCalls,[{url:`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets(properties(sheetId,title,index))`,options:{headers:{authorization:"Bearer SYNTHETIC_TOKEN"}}}]);await mark("tabs-whole-response-raw-request");
  // Preserve original guard/HTTP/parser. Failure sanitization lane has explicit differing expected text.
  for(const [name,values,body,error] of [["sourceName-normal",table(1),{sourceName:123},backend==="original"?"body.sourceName?.trim is not a function":"스프레드시트를 가져오지 못했습니다."],["sourceName-header-only",[HEAD],{sourceName:123},"저장할 행이 없습니다."],["empty",[],{},"헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요."],["header-fraction",table(1),{headerRowNumber:1.5},"저장할 행이 없습니다."],["header-string",table(1),{headerRowNumber:"2"},"저장할 행이 없습니다."],["malformed-row",[null],{},backend==="original"?"Cannot read properties of null (reading 'map')":"스프레드시트를 가져오지 못했습니다."],["header99",table(1),{headerRowNumber:99},"헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요."]] as Array<[string,unknown,Row,string]>){
   transportPayload={values};fetchCalls.length=0;const before=canonical([await raw("DataImportRun"),await raw("OperationSourceRecord")]);const res=await request(body);assert.equal(res.status,400);assert.deepEqual(await res.json(),{ok:false,error});assert.equal(fetchCalls.length,1);assert.equal(canonical([await raw("DataImportRun"),await raw("OperationSourceRecord")]),before);await mark(name,"expected-failure-no-staging");
  }
  transportStatus=403;transportPayload={error:"SYNTHETIC_CANARY"};const denied=await request({},"tabs");assert.equal(denied.status,400);assert.deepEqual(await denied.json(),{ok:false,error:"스프레드시트를 읽을 권한이 없습니다. Google로 다시 로그인해 권한을 허용해 주세요."});transportStatus=200;transportError=undefined;await mark("raw-http403");
  {
   // Identical raw source/rosters/metadata and literal tuple on original PG, current PG, native Mongo.
   transportPayload={values:table(1)};
   const overlapName="race-overlap-reads-first";
   const observed:Array<{response:Response;before:number;after:number}>=[];fetchCalls.length=0;
   const work=async()=>{const before=Date.now(),response=await request({sourceName:overlapName}),after=Date.now();observed.push({response:response.clone(),before,after});assert.equal(response.status,200);const body=await response.json() as Row;assert.deepEqual(body,{ok:true,duplicateCount:0,errorCount:1,headerRowNumber:1,importRunId:body.importRunId,rowCount:1,storedCount:1});return String(body.importRunId);};
   const auditCountBefore=(await read("ActivityRequest")).length;
   const {results,traces}=prisma?await bothReadsBeforeCommit(prisma,work):await bothNativeReadsBeforeCommit(overlapName,work);assert.equal(new Set(results).size,2);assert.equal(fetchCalls.length,2);assert.equal((await read("ActivityRequest")).length,auditCountBefore+2);
   for(const observation of observed)await normal(overlapName,1,{},false,observation);
   const rr=(await read("DataImportRun")).filter(r=>r.sourceName===overlapName);assert.equal(rr.length,2);
   for(const run of rr){const rows=(await read("OperationSourceRecord")).filter(r=>r.importRunId===run.id);assert.equal(rows.length,1);assert.deepEqual(rows[0].mappedFields,expectedFields(0));assert.deepEqual(rows[0].validationErrors,ERRORS);assert.equal(run.errorCount,1);assert.equal(run.rowCount,1);assert.equal(run.successCount,0);}
   await mark("race-overlap-reads-before-commit",{traces,runs:2,rows:2,sourceCalls:2,requestAudits:2});
   const sequentialAuditBefore=(await read("ActivityRequest")).length;
   const firstId=await normal("race-first-commit-before-second-read",1);
   // normal awaits actual POST (including withTransaction commit + wrapper audit),
   // then independently verifies the committed raw row before the second source call starts.
   assert.equal((await read("OperationSourceRecord")).filter(r=>r.importRunId===firstId).length,1);
   const secondId=await normal("race-first-commit-before-second-read",1,{},true);
   assert.notEqual(firstId,secondId);assert.equal((await read("OperationSourceRecord")).filter(r=>r.importRunId===secondId).length,0);
   assert.equal((await read("ActivityRequest")).length,sequentialAuditBefore+2);
   await mark("race-first-commit-before-second-read-order",{trace:["first-POST-commit-audit-complete","committed-row-observed","second-source-read-and-POST"],runs:2,rows:1,sourceCalls:2,requestAudits:2});
  }
  assert.equal(canonical(await Promise.all((["Company","Course","OperationSession"] as Model[]).map(raw))),sentinel);
  assert.equal(canonical(await raw("ActivityChange")),changeAudit);
  await send({kind:"result",backend,ledger});
 }finally{
  await prisma?.$disconnect();
  if(sql){if(owned){for(const t of ["operation_source_records","data_import_runs","operation_sessions","courses","companies","team_users","instructor_notes","activity_changes","activity_requests"])await sql.query(`DELETE FROM "${t}"`);for(const t of [...Object.values(tables),"team_users","instructor_notes"])assert.equal(Number((await sql.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n),0);await send({kind:"cleanup",backend,remaining:0});}await sql.end();}
  if(client){if(owned){await client.db(dbName).dropDatabase();assert.equal((await client.db(dbName).listCollections().toArray()).length,0);await send({kind:"cleanup",backend,remaining:0});}await client.close();}
 }
}
main().catch(async e=>{await send({kind:"failure",message:e instanceof Error?e.stack:String(e)});process.exitCode=1;});
