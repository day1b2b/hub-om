/** V4 native A/B overlap: actual reader/handler/repositories, transport-only source seam.
 * Parent executes in the already isolated native worker. No shared env mutation.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { MongoClient } from "mongodb";
import { expectedIds,registerId,registerRow,assertCompleteIds,identityNegativeControls,type ExpectedIds } from "./notionImportParityIds.fixture.ts";
import { EMAIL,TOKEN,page,fingerprint,record,dateText,type Row } from "./notionImportParityLiterals.fixture.ts";
import { MongoImportRepository,prepareMongoImportStore,IMPORT_MODELS } from "./mongoImportRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoInstructorNoteRepository,INSTRUCTOR_NOTE_MODELS } from "./mongoInstructorNoteRepository";
import { MongoRequestAuditRepository,prepareMongoRequestAuditStore,REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { prepareMongoReadStore,TEAM_READ_MODELS } from "./mongoReadStore";
import { MongoOperationStore } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument,MongoDbNull,MongoJsonNull } from "./mongoRuntimeCodec";
import { runWithDataRepositories,type DataRepositories } from "./dataRepositoryContext";
import { readNotionDatabaseImport } from "./notionImport";
import { getImportRepository } from "./importRepositoryFactory";

export async function nativeIsolation(client:MongoClient,post:(request:Request)=>Promise<Response>){
 assert.equal(process.env.DATABASE_URL,undefined);assert.equal(process.env.NOTION_TOKEN,TOKEN);
 const lanes=new AsyncLocalStorage<{name:string;databaseId:string;index:number;calls:number;fail:boolean;overlap:boolean}>();
 const previousFetch=globalThis.fetch;
 const resources:Array<{databaseName:string;scope:Partial<DataRepositories>;store:MongoOperationStore;checkedIds:ExpectedIds}>=[];
 const inputs=[page(700),page(701)];
 let arrivals=0,release:()=>void=()=>{},timedOut=false;
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  for(const name of ["a","b"]){
   const databaseName=`hub_om_shadow_notion_ab_${name}_${randomBytes(8).toString("hex")}`;
   assert.equal((await client.db(databaseName).listCollections().toArray()).length,0);
   const options={client,databaseName,namespace:`shadow_notion_${name}`,allowShadowWrites:true as const};
   const store=new MongoOperationStore(options,[...new Set([...IMPORT_MODELS,...TEAM_READ_MODELS,...INSTRUCTOR_NOTE_MODELS,...REQUEST_AUDIT_MODELS])]);
   // Track ownership before any prepare write so setup failures still clean this database.
   const resource={databaseName,scope:{} as Partial<DataRepositories>,store,checkedIds:expectedIds()};resources.push(resource);
   await prepareMongoImportStore(options);await prepareMongoReadStore(options,TEAM_READ_MODELS);await prepareMongoReadStore(options,INSTRUCTOR_NOTE_MODELS);await prepareMongoRequestAuditStore(options);
   resource.scope={imports:await MongoImportRepository.open(options),teamMembers:await MongoTeamMemberRepository.open(options),instructorNote:await MongoInstructorNoteRepository.open(options),requestActivity:await MongoRequestAuditRepository.open(options),notionImportSource:{readDatabase:readNotionDatabaseImport}};
  }
  globalThis.fetch=async(input,options)=>{
   const lane=lanes.getStore();assert.ok(lane,"UNSCOPED_EXTERNAL_FETCH_FORBIDDEN");
   assert.equal(String(input),`https://api.notion.com/v1/databases/${lane.databaseId}/query`);
   assert.deepEqual(options,{method:"POST",headers:{Authorization:`Bearer ${TOKEN}`,"Content-Type":"application/json","Notion-Version":"2022-06-28"},body:JSON.stringify({page_size:100,...(lane.index?{start_cursor:"next"}:{})}),cache:"no-store"});
   assert.ok(lane.index<2);lane.calls++;
   if(lane.overlap&&lane.index===0){arrivals++;if(arrivals===2)release();await barrier;}
   if(lane.fail)throw new Error("SYNTHETIC_AB_SOURCE_CANARY");
   const index=lane.index++;
   return new Response(JSON.stringify({results:[inputs[index].raw],has_more:index===0,next_cursor:index===0?"next":null}),{status:200});
  };
  async function execute(which:number,name:string,overlap=false,fail=false){
   const resource=resources[which],databaseId=which===0?"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
   const lane={name,databaseId,index:0,calls:0,fail,overlap};
   const read=async(model:string)=>(await resource.store.collection(model).find({}).toArray()).map(doc=>Object.fromEntries(Object.entries(decodeMongoRuntimeDocument(model,doc)).filter(([key])=>!key.endsWith("PiiIndex")).map(([key,value])=>[key,value===MongoDbNull||value===MongoJsonNull?null:value])));
   const rawState=async()=>Promise.all(["DataImportRun","OperationSourceRecord"].map(m=>resource.store.collection(m).find({}).sort({_id:1}).toArray()));
   const beforeState=await rawState(),before=Date.now();
   const response=await lanes.run(lane,()=>runWithDataRepositories(resource.scope,()=>post(new Request("http://synthetic.invalid/api/admin/imports/notion/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({databaseUrl:databaseId,sourceTeam:"team_1",sourceName:name})}))));
   const after=Date.now(),body=await response.json() as Row,requestId=response.headers.get("X-Request-Id");assert.ok(requestId);registerId(resource.checkedIds.audits,requestId,"scope request audit");
   const audits=(await read("ActivityRequest")).filter(r=>r.id===requestId);assert.equal(audits.length,1);const audit=audits[0];
   assert.ok(audit.occurredAt instanceof Date);assert.ok(audit.occurredAt.getTime()>=before-2&&audit.occurredAt.getTime()<=after+2);
   assert.ok(Number.isInteger(audit.durationMs)&&Number(audit.durationMs)>=0);
   assert.deepEqual(audit,{id:requestId,occurredAt:audit.occurredAt,actorEmail:EMAIL,actorName:"Synthetic Parity",actorType:"user",route:"/api/admin/imports/notion/import",method:"POST",status:fail?400:200,durationMs:audit.durationMs});
   for(const model of ["Company","Course","OperationSession","ActivityChange"])assert.equal(await resource.store.collection(model).countDocuments({}),0);
   if(fail){assert.equal(response.status,400);assert.deepEqual(body,{ok:false,error:"Notion 데이터를 가져오지 못했습니다."});assert.equal(lane.calls,1);assert.deepEqual(await rawState(),beforeState);return {name,body,status:response.status,stagingUnchanged:true};}
   assert.equal(response.status,200);assert.equal(lane.calls,2);const id=String(body.importRunId);assert.match(id,/^[0-9a-f-]{36}$/);
   assert.deepEqual(body,{ok:true,duplicateCount:0,errorCount:2,importRunId:id,rowCount:2,storedCount:2});
   registerId(resource.checkedIds.runs,id,"scope import run");
   const runs=(await read("DataImportRun")).filter(r=>r.id===id);assert.equal(runs.length,1);const run=runs[0];
   for(const key of ["startedAt","finishedAt"]){assert.ok(run[key] instanceof Date);assert.ok((run[key] as Date).getTime()>=before-2&&(run[key] as Date).getTime()<=after+2);}
   assert.deepEqual(run,{id,sourceTeam:"TEAM_1",sourceType:"notion",sourceName:name,workbookName:databaseId,fileName:null,status:"COMPLETED_WITH_ERRORS",rowCount:2,successCount:0,errorCount:2,importedBy:EMAIL,startedAt:run.startedAt,finishedAt:run.finishedAt,notes:null,validationLogs:inputs.map((row,i)=>({rowNumber:i+2,errors:row.errors}))});
   const rows=(await read("OperationSourceRecord")).filter(r=>r.importRunId===id).sort((a,b)=>Number(a.sourceRowNumber)-Number(b.sourceRowNumber));assert.equal(rows.length,2);
   for(const [i,row] of rows.entries()){
    assert.ok(row.createdAt instanceof Date);assert.ok(row.createdAt.getTime()>=before-2&&row.createdAt.getTime()<=after+2);
    assert.deepEqual(row,{id:row.id,importRunId:id,operationSessionId:null,sourceTeam:"TEAM_1",sourceWorkbook:databaseId,sourceSheet:"Notion",sourceRowNumber:i+2,headerRowNumber:1,sourceFingerprint:fingerprint(inputs[i]),rowSnapshot:inputs[i].snapshot,mappedFields:inputs[i].fields,unmappedFields:{},validationErrors:inputs[i].errors,createdAt:row.createdAt});
   }
   for(const row of rows)registerRow(resource.checkedIds,String(row.id),id);
   const summary={id,sourceTeam:"1팀",sourceType:"notion",status:"오류있음",rowCount:2,successCount:0,errorCount:2,sourceRecordCount:2,importedBy:EMAIL,startedAt:dateText(run.startedAt as Date),finishedAt:dateText(run.finishedAt as Date),notes:"",fileName:name,validationLogCount:2};
   const expected={...summary,records:rows.map((row,i)=>record(inputs[i],String(row.id),row.createdAt as Date,"1팀",i+2))};
   const detail=await runWithDataRepositories(resource.scope,()=>getImportRepository().getImportRunById(id));assert.deepEqual(detail,expected);
   assert.ok((await runWithDataRepositories(resource.scope,()=>getImportRepository().listImportRuns())).some(r=>{if(r.id!==id)return false;assert.deepEqual(r,summary);return true;}));
   const other=resources[1-which];assert.equal(await other.store.collection("DataImportRun").countDocuments({_id:id}),0);assert.equal(await other.store.collection("ActivityRequest").countDocuments({_id:requestId}),0);
   return {name,status:response.status,body:{...body,importRunId:"<run>"},run:{...run,id:"<run>",startedAt:"<date>",finishedAt:"<date>"},rows:rows.map((r,i)=>({...r,id:`<row:${i}>`,importRunId:"<run>",createdAt:"<date>"})),audit:{...audit,id:"<request>",occurredAt:"<date>",durationMs:"<duration>"},detail:{...expected,id:"<run>",startedAt:"<date>",finishedAt:"<date>",records:expected.records.map((r,i)=>({...r,id:`<row:${i}>`,createdAt:"<date>"}))}};
  }
  timer=setTimeout(()=>{timedOut=true;release();},15000);
  const settled=await Promise.allSettled([execute(0,"scope-a",true),execute(1,"scope-b",true)]);clearTimeout(timer);
  assert.equal(timedOut,false,"native A/B source barrier timed out");assert.equal(arrivals,2);
  const results=settled.map(result=>{if(result.status==="rejected")throw result.reason;return result.value;});
  results.push(await execute(1,"scope-b-failure",false,true));
  results.push(await execute(0,"scope-a-recovery"));results.push(await execute(1,"scope-b-recovery"));
  const identityEvidence=[];
  for(const resource of resources){
   const all=async(model:string)=>(await resource.store.collection(model).find({}).toArray()).map(doc=>decodeMongoRuntimeDocument(model,doc));
   const actual={runs:(await all("DataImportRun")).map(r=>({id:r.id})),rows:(await all("OperationSourceRecord")).map(r=>({id:r.id,importRunId:r.importRunId})),audits:(await all("ActivityRequest")).map(r=>({id:r.id}))};
   assertCompleteIds(actual,resource.checkedIds);const negativeControls=identityNegativeControls(actual,resource.checkedIds);
   assert.equal(resource.checkedIds.runs.size,2);assert.equal(resource.checkedIds.rows.size,4);
   assert.equal(resource.checkedIds.audits.size,resource===resources[0]?2:3);
   identityEvidence.push({runs:resource.checkedIds.runs.size,rows:resource.checkedIds.rows.size,audits:resource.checkedIds.audits.size,negativeControls});
  }
  assert.equal(process.env.NOTION_TOKEN,TOKEN);assert.equal(process.env.DATABASE_URL,undefined);
  return {kind:"native-isolation",results,sharedServerTokenUnchanged:true,sourceArrivals:arrivals,identityEvidence};
 }finally{
  clearTimeout(timer);release();globalThis.fetch=previousFetch;
  for(const resource of resources){await client.db(resource.databaseName).dropDatabase();assert.equal((await client.db(resource.databaseName).listCollections().toArray()).length,0);}
 }
}
