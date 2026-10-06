/** Independent synthetic gate contract; no product imports. */
import assert from "node:assert/strict";
export const ROOT="/private/tmp/hub-om-drive-writer-20260930";
export const DATABASES={legacy:"drive_writer_legacy",no_defaults:"drive_writer_no_defaults",current:"drive_writer_test"} as const;
export type Variant=keyof typeof DATABASES;
export const IDS={company:"10000000-0000-4000-8000-000000000001",course:"20000000-0000-4000-8000-000000000001",scan:"30000000-0000-4000-8000-000000000001",search:"30000000-0000-4000-8000-000000000002"};
export const LINK="https://drive.google.com/drive/folders/SYNTHETIC_FOLDER_000001";
export const ISSUES=["GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL 또는 GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL 설정이 필요합니다.","GOOGLE_DRIVE_PRIVATE_KEY 또는 GOOGLE_CALENDAR_PRIVATE_KEY 설정이 필요합니다."];
export const GUARD_ERROR="This legacy SQL job is incompatible with encrypted storage. Use the application's encrypted repository/sync API; do not bypass the storage checks.";
export const SUMMARY={avgSatisfactionCandidates:0,errors:0,folderSearches:1,folderSearchWithCandidates:0,instructorCandidates:0,instructorSatisfactionCandidates:0,scanFoundFolder:1,scanIssues:1,scannedRefs:1,suspicious:{badInstructorFragments:0,clockInstructorCandidates:0,zeroSatisfactionCandidates:0},suspiciousCandidateCount:0};
export function expectedDates(tz:string){assert.ok(tz==="UTC"||tz==="Asia/Seoul");return tz==="UTC"?{start:"2032-02-03",end:"2032-02-04",driverStart:"2032-02-03T00:00:00.000Z",driverEnd:"2032-02-04T00:00:00.000Z"}:{start:"2032-02-02",end:"2032-02-03",driverStart:"2032-02-02T15:00:00.000Z",driverEnd:"2032-02-03T15:00:00.000Z"};}
export interface QueryObservation {kind:string;ok:boolean;code?:string;encrypted?:boolean;driverRows?:unknown[];params?:unknown[];returnedRunId?:string}
export interface Report {queries:QueryObservation[];sources:Array<{method:string;args:unknown[];result:unknown}>;violations:string[];connects:number;ends:number;fetches:number;stdout:unknown[];error?:{guard:boolean;code?:string};bootstrapFailed?:boolean;exitCode?:number}
export function assertTrace(r:Report,variant:Variant){
 assert.equal(r.bootstrapFailed,undefined,"BOOTSTRAP_FAILURE");assert.deepEqual(r.violations,[],"OBSERVER_VIOLATION");assert.equal(r.fetches,0,"EXTERNAL_FETCH_ATTEMPT");assert.equal(r.connects,1);assert.equal(r.queries[0]?.kind,"guard");
 if(variant==="current"){
  assert.deepEqual(r.queries,[{kind:"guard",ok:true,encrypted:true}]);assert.equal(r.ends,1);assert.equal(r.sources.length,0);assert.deepEqual(r.stdout,[]);assert.deepEqual(r.error,{guard:true});assert.equal(r.exitCode,1);
 }else if(variant==="no_defaults"){
  assert.deepEqual(r.queries.map(q=>q.kind),["guard","load","createRun"]);assert.equal(r.queries[0].encrypted,false);assert.equal(r.queries[1].ok,true);assert.equal(r.queries[2].ok,false);assert.equal(r.queries[2].code,"23502");assert.equal(r.sources.length,0);assert.deepEqual(r.stdout,[]);assert.deepEqual(r.error,{guard:false,code:"23502"});assert.equal(r.exitCode,1);
 }else{
  assert.deepEqual(r.queries.map(q=>q.kind),["guard","load","createRun","appendResult","appendResult","finishRun"]);assert.ok(r.queries.every(q=>q.ok));assert.equal(r.queries[0].encrypted,false);assert.equal(r.ends,1);assert.equal(r.sources.length,2);assert.equal(r.error,undefined);assert.equal(r.exitCode,0);
 }
}
export function traceNegativeControls(good:Report,variant:Variant){
 assertTrace(structuredClone(good),variant);
 const extra=structuredClone(good);extra.fetches++;assert.throws(()=>assertTrace(extra,variant),{name:"AssertionError"});
 const sql=structuredClone(good);sql.queries.push({kind:"unexpected",ok:true});assert.throws(()=>assertTrace(sql,variant),{name:"AssertionError"});
 const swallowed=structuredClone(good);swallowed.violations.push("SYNTHETIC_CONTRACT_FAILURE");assert.throws(()=>assertTrace(swallowed,variant),{name:"AssertionError"});
}
