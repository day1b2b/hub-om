/** Full-store identity oracle. Expected IDs come only from checked response/row/audit tuples. */
import assert from "node:assert/strict";
export interface ExpectedIds { runs:Set<string>; rows:Map<string,string>; audits:Set<string> }
export interface StoredIds { runs:Array<{id:unknown}>; rows:Array<{id:unknown;importRunId:unknown}>; audits:Array<{id:unknown}> }
export const expectedIds=():ExpectedIds=>({runs:new Set(),rows:new Map(),audits:new Set()});
export function registerId(ids:Set<string>,id:string,label:string){assert.ok(!ids.has(id),`${label}: response identity reused`);ids.add(id);}
export function registerRow(ids:ExpectedIds,id:string,run:string){assert.ok(!ids.rows.has(id),"source row identity reused");assert.ok(ids.runs.has(run),"source parent must be a checked response run");ids.rows.set(id,run);}
export function assertCompleteIds(actual:StoredIds,expected:ExpectedIds){
 function exact(rows:Array<{id:unknown}>,ids:Iterable<string>,label:string){
  const values=rows.map(row=>{assert.equal(typeof row.id,"string",`${label}: string id`);return row.id as string;});
  assert.equal(new Set(values).size,values.length,`${label}: duplicate IDs`);
  assert.deepEqual(values.sort(),[...ids].sort(),`${label}: whole-store ID bijection`);
 }
 exact(actual.runs,expected.runs,"DataImportRun");exact(actual.rows,expected.rows.keys(),"OperationSourceRecord");exact(actual.audits,expected.audits,"ActivityRequest");
 for(const row of actual.rows){assert.equal(row.importRunId,expected.rows.get(String(row.id)),"OperationSourceRecord: checked parent edge");assert.ok(expected.runs.has(String(row.importRunId)),"OperationSourceRecord: orphan");}
}
export function identityNegativeControls(actual:StoredIds,expected:ExpectedIds){
 assertCompleteIds(actual,expected);assertCompleteIds(structuredClone(actual),expected);assert.ok(actual.runs.length&&actual.rows.length&&actual.audits.length);
 const variants:StoredIds[]=[];
 const extraAudit=structuredClone(actual);extraAudit.audits.push({id:"SYNTHETIC_UNREFERENCED_AUDIT"});variants.push(extraAudit);
 const orphan=structuredClone(actual);orphan.rows.push({id:"SYNTHETIC_ORPHAN_ROW",importRunId:"SYNTHETIC_MISSING_RUN"});variants.push(orphan);
 const extraLinked=structuredClone(actual);extraLinked.rows.push({id:"SYNTHETIC_EXTRA_LINKED_ROW",importRunId:actual.runs[0].id});variants.push(extraLinked);
 const extraRun=structuredClone(actual);extraRun.runs.push({id:"SYNTHETIC_UNREFERENCED_RUN"});variants.push(extraRun);
 const missing=structuredClone(actual);missing.rows.pop();variants.push(missing);
 const substituted=structuredClone(actual);substituted.audits[0]={id:"SYNTHETIC_SAME_COUNT_SUBSTITUTE"};variants.push(substituted);
 const duplicate=structuredClone(actual);duplicate.audits.push({...duplicate.audits[0]});variants.push(duplicate);
 const brokenParent=structuredClone(actual);brokenParent.rows[0].importRunId="SYNTHETIC_MISSING_RUN";variants.push(brokenParent);
 for(const bad of variants)assert.throws(()=>assertCompleteIds(bad,expected),{name:"AssertionError"});
 assertCompleteIds(actual,expected);return variants.length;
}
