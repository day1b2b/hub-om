/** Observes real original/current PG duplicate read; no result substitution or isolation tuning. */
import assert from "node:assert/strict";
import type { PrismaClient, Prisma } from "@prisma/client";
export async function bothReadsBeforeCommit(prisma:PrismaClient,work:()=>Promise<unknown>){
 const global=globalThis as unknown as {prisma?:PrismaClient};const previous=global.prisma;
 let arrivals=0,release:()=>void=()=>{};const barrier=new Promise<void>(r=>{release=r;});
 const traces:string[]=[];
 type Transaction=(fn:(tx:Prisma.TransactionClient)=>Promise<unknown>,options?:unknown)=>Promise<unknown>;
 const original=prisma.$transaction.bind(prisma) as unknown as Transaction;
 global.prisma=new Proxy(prisma,{get(target,key,receiver){
  if(key!=="$transaction")return Reflect.get(target,key,receiver);
  return (fn:(tx:Prisma.TransactionClient)=>Promise<unknown>,options?:unknown)=>original(async tx=>fn(new Proxy(tx,{get(t,k,r){
   if(k!=="operationSourceRecord")return Reflect.get(t,k,r);
   const delegate=t.operationSourceRecord;
   return new Proxy(delegate,{get(d,method,rr){const value=Reflect.get(d,method,rr);if(method!=="findMany")return value;
    return async(...args:unknown[])=>{const result=await Reflect.apply(value,d,args);arrivals++;traces.push(`duplicate-read-${arrivals}-returned`);assert.ok(arrivals<=2);if(arrivals===2)release();await barrier;return result;};
   }});
  }})),options);
 }});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;release();},15000);
 try {const settled=await Promise.allSettled([work(),work()]);assert.equal(timedOut,false,"duplicate-read barrier timed out; overlap not established");const results=settled.map(result=>{if(result.status==="rejected")throw result.reason;return result.value;});assert.equal(arrivals,2);assert.deepEqual(traces,["duplicate-read-1-returned","duplicate-read-2-returned"]);return {results,traces};}
 finally{clearTimeout(timer);release();global.prisma=previous;}
}

/** Native counterpart: delegate the actual authenticated candidate scan, then hold
 * both snapshots before either callback can insert. Empty candidates are the
 * repository's real duplicate-read result for this fresh sourceName (no fabricated rows).
 */
export async function bothNativeReadsBeforeCommit(sourceName:string,work:()=>Promise<unknown>){
 const {MongoOperationStore}=await import("./mongoOperationStore");
 const {mongoRuntimeBlindIndex}=await import("./mongoRuntimeCodec");
 const prototype=MongoOperationStore.prototype,original=prototype.scan;
 const key=mongoRuntimeBlindIndex("DataImportRun","sourceName",sourceName);
 let arrivals=0,timedOut=false,release:()=>void=()=>{};
 const barrier=new Promise<void>(resolve=>{release=resolve;});const traces:string[]=[];
 prototype.scan=async function(...args:Parameters<typeof original>){
  const result=await original.apply(this,args);
  const [model,filter,session]=args;
  if(model==="DataImportRun"&&filter?.sourceNamePiiIndex===key&&filter?.sourceType==="spreadsheet"){
   assert.ok(session?.inTransaction(),"native duplicate read must use actual transaction snapshot");
   assert.deepEqual(result,[],"fresh race sourceName must have no historical candidates");
   arrivals++;assert.ok(arrivals<=2,"unexpected transaction callback retry in controlled schedule");
   traces.push(`duplicate-read-${arrivals}-returned`);if(arrivals===2)release();await barrier;
  }
  return result;
 };
 const timer=setTimeout(()=>{timedOut=true;release();},15000);
 try{
  const settled=await Promise.allSettled([work(),work()]);
  assert.equal(timedOut,false,"native duplicate-read barrier timed out; overlap not established");
  const results=settled.map(result=>{if(result.status==="rejected")throw result.reason;return result.value;});
  assert.equal(arrivals,2);assert.deepEqual(traces,["duplicate-read-1-returned","duplicate-read-2-returned"]);
  return {results,traces};
 }finally{clearTimeout(timer);release();prototype.scan=original;}
}
