/** No original source copies: verified immutable git blobs only, including the scanner. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks,stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
export const BASELINE="3c72e6997e057b7811e128e12ca6b354065de66a";
export const ROOT=fileURLToPath(new URL("../../../../",import.meta.url));
export interface Edge {specifier:string;typeOnly:boolean;target?:string;external?:boolean}
export interface Entry {originPath:string;gitBlob:string;sha256:string;role:string;edges:Edge[]}
export interface Manifest {baseline:string;roots:string[];files:Entry[];externalPackagesOrBuiltins:string[];migrations:string[]}
export const manifest=JSON.parse(readFileSync(new URL("./closure-manifest.json",import.meta.url),"utf8")) as Manifest;
const entries=new Map(manifest.files.map(e=>[e.originPath,e]));
export const hash=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
export function verifyBytes(origin:string,bytes:Uint8Array){const e=entries.get(origin);assert.ok(e,"UNREGISTERED_ORIGINAL");assert.equal(hash(bytes),e.sha256,"ORIGINAL_HASH_MISMATCH");}
export function originalBytes(origin:string):Buffer{
 const e=entries.get(origin);assert.ok(e,"UNREGISTERED_ORIGINAL");
 let blob:string,bytes:Buffer;
 try{blob=execFileSync("git",["rev-parse",`${BASELINE}:${origin}`],{cwd:ROOT,stdio:["ignore","pipe","ignore"]}).toString().trim();bytes=execFileSync("git",["cat-file","blob",e.gitBlob],{cwd:ROOT,stdio:["ignore","pipe","ignore"],maxBuffer:20*1024*1024});}
 catch{throw new Error("ORIGINAL_GIT_OBJECT_UNAVAILABLE");}
 assert.equal(blob,e.gitBlob,"ORIGINAL_BLOB_MISMATCH");verifyBytes(origin,bytes);return bytes;
}
export function verifyOriginal(){assert.equal(manifest.baseline,BASELINE);for(const e of manifest.files)originalBytes(e.originPath);for(const p of ["package.json","package-lock.json","prisma/schema.prisma","scripts/ts-loader.mjs"])verifyBytes(p,readFileSync(new URL(`../../../../${p}`,import.meta.url)));return manifest;}
export function resolveEdge(origin:string,specifier:string):Edge{
 const edge=entries.get(origin)?.edges.find(e=>e.specifier===specifier&&!e.typeOnly);assert.ok(edge,"UNDECLARED_ORIGINAL_EDGE");
 if(edge.target)assert.ok(entries.has(edge.target),"CURRENT_MODULE_ESCAPE");else assert.ok(edge.external&&manifest.externalPackagesOrBuiltins.includes(specifier),"EXTERNAL_MODULE_ESCAPE");return edge;
}
const urls=new Map<string,string>(),origins=new Map<string,string>();
export function originalURL(origin:string):string{
 const cached=urls.get(origin);if(cached)return cached;
 const bytes=originalBytes(origin);const source=origin.endsWith(".ts")?stripTypeScriptTypes(bytes.toString(),{mode:"strip"}):bytes.toString();
 const url=`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${encodeURIComponent(origin)}`;
 urls.set(origin,url);origins.set(url,origin);return url;
}
export function installOriginalResolver(seams?:{pgURL:string;sourceObserverURL:(actualURL:string)=>string}){
 verifyOriginal();return registerHooks({resolve(specifier,context,next){
  const origin=origins.get(context.parentURL??"");if(!origin)return next(specifier,context);
  const edge=resolveEdge(origin,specifier);
  if(seams&&origin==="scripts/run-drive-import-dry-run.mjs"&&specifier==="pg")return {url:seams.pgURL,shortCircuit:true};
  if(edge.target){const actual=originalURL(edge.target);return {url:seams&&origin==="scripts/run-drive-import-dry-run.mjs"&&edge.target==="src/lib/driveImports/googleDriveOperationScanner.ts"?seams.sourceObserverURL(actual):actual,shortCircuit:true};}
  return next(specifier,{...context,parentURL:import.meta.url});
 }});
}

/** Exercise the installed resolver with a synthetic import, never modified original bytes. */
export async function rejectCurrentEscape(){
 const hook=installOriginalResolver();
 const url=`data:text/javascript;base64,${Buffer.from(`import ${JSON.stringify(new URL("../../../../src/lib/data/prisma.ts",import.meta.url).href)};`).toString("base64")}#synthetic-current-escape`;
 origins.set(url,"scripts/run-drive-import-dry-run.mjs");
 try{await assert.rejects(import(url),/UNDECLARED_ORIGINAL_EDGE/);}finally{origins.delete(url);hook.deregister();}
}
