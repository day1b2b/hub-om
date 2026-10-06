/** Independent literal expectations. Never imports product parser/presenter/selector. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
export type Row=Record<string,unknown>;
export const EMAIL="synthetic@day1company.co.kr",SHEET="SYNTHETIC_SHEET",TAB="Synthetic ' Tab";
export const HEAD=["기업명","과정명","시작일","종료일","미매핑"];
export const ERRORS=["담당OM 정보가 없습니다.","담당LD 정보가 없습니다."];
export const DUP="이미 같은 행이 저장되어 있어 중복 저장하지 않았습니다.";
export function cells(i:number):string[]{return ["SYNTHETIC_COMPANY",`SYNTHETIC_COURSE_${String(i).padStart(3,"0")}`,"2032-02-03","2032-02-04","SYNTHETIC_EXTRA"];}
export function table(n:number){return [HEAD,...Array.from({length:n},(_,i)=>cells(i))];}
export function expectedFields(i:number){return {companyName:"SYNTHETIC_COMPANY",courseName:`SYNTHETIC_COURSE_${String(i).padStart(3,"0")}`,endDate:"2032-02-04",startDate:"2032-02-03"};}
export function snapshot(i:number){return {"기업명":"SYNTHETIC_COMPANY","과정명":`SYNTHETIC_COURSE_${String(i).padStart(3,"0")}`,"시작일":"2032-02-03","종료일":"2032-02-04","미매핑":"SYNTHETIC_EXTRA"};}
export function fingerprint(i:number){const row=snapshot(i);return createHash("sha256").update(JSON.stringify(Object.keys(row).sort().map(k=>[k,row[k as keyof typeof row]]))).digest("hex");}
export function dateText(d:Date){return new Intl.DateTimeFormat("ko-KR",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Seoul"}).format(d);}
export function expectedRecord(i:number,id:string,createdAt:Date,team="1팀",rowNumber=i+2):Row {
 const f=expectedFields(i),s=snapshot(i);
 return {id,sourceTeam:team,sourceRowNumber:rowNumber,headerRowNumber:1,sourceFingerprint:fingerprint(i),linkedOperationId:"",linkedOperation:null,mappedFieldCount:4,
 mappedFields:[{key:"companyName",label:"기업명",value:f.companyName},{key:"courseName",label:"과정명",value:f.courseName},{key:"endDate",label:"종료일",value:f.endDate},{key:"startDate",label:"시작일",value:f.startDate}],
 unmappedFieldCount:1,unmappedFields:[{key:"미매핑",label:"미매핑",value:"SYNTHETIC_EXTRA"}],
 rowSnapshotPreview:[{key:"기업명",label:"기업명",value:s.기업명},{key:"과정명",label:"과정명",value:s.과정명},{key:"시작일",label:"시작일",value:s.시작일},{key:"종료일",label:"종료일",value:s.종료일},{key:"미매핑",label:"미매핑",value:s.미매핑}],
 missingRequiredFields:[],reviewStatus:"확인 필요",validationErrors:ERRORS,createdAt:dateText(createdAt)};
}
export function expectedSummary(run:Row,count:number):Row{
 // Only generated identity/time flow from storage. Every business field comes from caller's literal fixture.
 return {id:run.id,sourceTeam:run.sourceTeam,sourceType:run.sourceType??"spreadsheet",status:"오류있음",rowCount:run.rowCount,successCount:0,errorCount:run.rowCount,sourceRecordCount:count,importedBy:EMAIL,startedAt:dateText(run.startedAt as Date),finishedAt:dateText(run.finishedAt as Date),notes:"",fileName:run.sourceName,validationLogCount:run.rowCount};
}
export function controls(){
 const good={a:null,rows:[{v:1},{v:2}]};
 for(const bad of [{rows:good.rows},{...good,extra:1},{...good,a:""},{...good,rows:[{v:2},{v:1}]},{...good,rows:[{v:1}]}])assert.throws(()=>assert.deepEqual(bad,good));
 assert.deepEqual({rows:good.rows,a:null},good);
}
