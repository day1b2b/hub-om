/** Independent fixture expectations. No product mapper/parser/presenter imports. */
import { createHash } from "node:crypto";
export type Row=Record<string,unknown>;
export const EMAIL="synthetic@day1company.co.kr", DATABASE="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const TOKEN="SYNTHETIC_NOTION_TOKEN", DUP="이미 같은 행이 저장되어 있어 중복 저장하지 않았습니다.";
export const MISSING=["담당OM 정보가 없습니다.","담당LD 정보가 없습니다."];
export interface LiteralPage { raw:Row; snapshot:Record<string,string>; fields:Record<string,string>; errors:string[]; missing:string[] }
export function page(i:number,kind:"normal"|"valid"|"known"|"unknown"|"invalid"|"empty"="normal"):LiteralPage{
 const compact=String(i+1).padStart(32,"0"),id=`${compact.slice(0,8)}-${compact.slice(8,12)}-${compact.slice(12,16)}-${compact.slice(16,20)}-${compact.slice(20)}`;
 const op=`NOTION-${compact}`,course=`SYNTHETIC_COURSE_${String(i).padStart(3,"0")}`,url=`https://synthetic.invalid/notion/${compact}`;
 if(kind==="empty")return {raw:{id,properties:{}},snapshot:{"운영ID":op},fields:{operationId:op},errors:[...MISSING],missing:["기업명","과정명","시작일","종료일"]};
 const properties:Row={"기업명":{type:"rich_text",rich_text:[{plain_text:"SYNTHETIC_COMPANY"}]},"과정명":{type:"title",title:[{plain_text:course}]},Date:{type:"date",date:{start:"2032-02-03T23:00:00-08:00",end:"2032-02-04T23:00:00-08:00"}},Ignored:{type:"number",number:9876}};
 const snapshot:Record<string,string>={"운영ID":op,"기업명":"SYNTHETIC_COMPANY","과정명":course,"시작일":"2032-02-03","종료일":"2032-02-04"};
 let fields:Record<string,string>={companyName:"SYNTHETIC_COMPANY",courseName:course,endDate:"2032-02-04"};
 let errors=[...MISSING],missing:string[]=[];
 if(kind==="valid"){
  properties["운영"]={type:"people",people:[{name:"SYNTHETIC_OM"}]};properties["기획"]={type:"people",people:[{name:"SYNTHETIC_LD"}]};
  snapshot["담당OM"]="SYNTHETIC_OM";snapshot["담당LD"]="SYNTHETIC_LD";fields={...fields,ld:"SYNTHETIC_LD",om:"SYNTHETIC_OM"};errors=[];
 }
 if(kind==="known"||kind==="unknown"){
  const name=kind==="known"?"SYNTHETIC_KNOWN":"SYNTHETIC_UNKNOWN";
  properties["강사"]={type:"multi_select",multi_select:[{name}]};snapshot["강사"]=name;fields={...fields,instructors:name};
  if(kind==="unknown")errors.push("강사에 강사DB 노션에 없는 이름이 있습니다: SYNTHETIC_UNKNOWN");
 }
 if(kind==="invalid"){
  properties.Date={type:"date",date:{start:"not-a-date",end:"bad-end"}};
  properties["운영"]={type:"rich_text",rich_text:[{plain_text:"SYNTHETIC_UNKNOWN_OM"}]};properties["기획"]={type:"rich_text",rich_text:[{plain_text:"SYNTHETIC_UNKNOWN_LD"}]};
  snapshot["시작일"]="not-a-date";snapshot["종료일"]="bad-end";snapshot["담당OM"]="SYNTHETIC_UNKNOWN_OM";snapshot["담당LD"]="SYNTHETIC_UNKNOWN_LD";
  fields={companyName:"SYNTHETIC_COMPANY",courseName:course,endDate:"bad-end",ld:"SYNTHETIC_UNKNOWN_LD",om:"SYNTHETIC_UNKNOWN_OM"};
  errors=["시작일 형식을 확인해야 합니다.","종료일 형식을 확인해야 합니다.","담당OM에 멤버 관리(팀 유저)에 없는 이름이 있습니다: SYNTHETIC_UNKNOWN_OM","담당LD에 멤버 관리(팀 유저)에 없는 이름이 있습니다: SYNTHETIC_UNKNOWN_LD"];
  missing=["시작일(형식 확인)","종료일(형식 확인)"];
 }
 snapshot["싱크업"]=url;
 fields={...fields,operationId:op,operationDetail:url,startDate:kind==="invalid"?"not-a-date":"2032-02-03"};
 return {raw:{id,url,properties},snapshot,fields,errors,missing};
}
export function fingerprint(row:LiteralPage){return createHash("sha256").update(JSON.stringify(Object.keys(row.snapshot).sort().map(k=>[k,row.snapshot[k]]))).digest("hex");}
export function dateText(d:Date){return new Intl.DateTimeFormat("ko-KR",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Seoul"}).format(d);}
const labels:Record<string,string>={companyName:"기업명",courseName:"과정명",endDate:"종료일",instructors:"강사",ld:"LD",om:"OM",operationId:"운영 ID",startDate:"시작일"};
export function record(row:LiteralPage,id:string,at:Date,team:string,physical:number):Row{
 return {id,sourceTeam:team,sourceRowNumber:physical,headerRowNumber:1,sourceFingerprint:fingerprint(row),linkedOperationId:"",linkedOperation:null,
 mappedFieldCount:Object.keys(row.fields).length,mappedFields:Object.entries(row.fields).map(([key,value])=>({key,label:labels[key]??key,value})),
 unmappedFieldCount:0,unmappedFields:[],rowSnapshotPreview:Object.entries(row.snapshot).slice(0,8).map(([key,value])=>({key,label:key,value})),missingRequiredFields:row.missing,reviewStatus:row.errors.length?"확인 필요":row.missing.length?"매칭 필요":"적용 준비",validationErrors:row.errors,createdAt:dateText(at)};
}
