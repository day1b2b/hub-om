/** Mutates only disposable copies, NEVER the original frozen tree/manifest or actual loader. No DB. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyClosure } from "./frozen-loader.fixture.ts";
const disposableRoot = "/private/tmp/hub-om-google-sheets-import-20260930/closure-negative";
async function main() {
  const manifest = verifyClosure(); mkdirSync(disposableRoot,{recursive:true});
  const root = mkdtempSync(path.join(disposableRoot,"case-"));
  const target = path.join(root,".claude/plans/mongodb-google-sheets-import/original");
  const mode = process.argv[2];
  const targetOrigin=process.argv[3]??"src/lib/data/prismaImportRepository.ts";
  assert.ok(["src/lib/data/prismaImportRepository.ts","src/lib/data/importRepositoryFactory.ts","src/lib/data/importReviewPresenter.ts"].includes(targetOrigin)); assert.ok(["frozen-byte","actual-loader-byte","undeclared-current-import"].includes(mode));
  try {
    mkdirSync(target,{recursive:true});
    copyFileSync(new URL("./frozen-loader.fixture.ts",import.meta.url),path.join(target,"frozen-loader.fixture.ts"));
    copyFileSync(new URL("./closure-manifest.txt",import.meta.url),path.join(target,"closure-manifest.txt"));
    for(const entry of manifest.files) {
      const dest=path.join(target,entry.frozenPath);mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(new URL(entry.frozenPath,import.meta.url),dest);
    }
    for(const origin of ["package.json","package-lock.json","prisma/schema.prisma","scripts/ts-loader.mjs"]) {
      const dest=path.join(root,origin);mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(new URL(`../../../../${origin}`,import.meta.url),dest);
    }
    if(mode==="frozen-byte") {
      const file=path.join(target,`${targetOrigin}.txt`);writeFileSync(file,readFileSync(file,"utf8")+"\n// synthetic byte mutation\n");
    } else if(mode==="actual-loader-byte") {
      const file=path.join(root,"scripts/ts-loader.mjs");writeFileSync(file,readFileSync(file,"utf8")+"\n// synthetic loader drift\n");
    } else {
      const file=path.join(target,`${targetOrigin}.txt`);
      // A physically present current-style module must still be rejected by the edge allowlist.
      const trap=path.join(root,"src/lib/data/undeclared-current.ts");mkdirSync(path.dirname(trap),{recursive:true});writeFileSync(trap,'throw new Error("UNSAFE_CURRENT_MODULE_EXECUTED");\n');
      const text='import "./undeclared-current.ts";\nexport {};\n';writeFileSync(file,text);
      const copied=JSON.parse(readFileSync(path.join(target,"closure-manifest.txt"),"utf8"));
      copied.files.find((entry:{originPath:string})=>entry.originPath===targetOrigin).sha256=createHash("sha256").update(text).digest("hex");
      writeFileSync(path.join(target,"closure-manifest.txt"),JSON.stringify(copied));
    }
    const loader=await import(pathToFileURL(path.join(target,"frozen-loader.fixture.ts")).href) as typeof import("./frozen-loader.fixture.ts");
    if(mode==="undeclared-current-import") await assert.rejects(loader.frozen(targetOrigin),/undeclared frozen edge/);
    else assert.throws(()=>loader.verifyClosure(),mode==="frozen-byte"?new RegExp(targetOrigin.replaceAll(".","\\.")):/actual runtime drift: scripts\/ts-loader.mjs/);
    if(!process.send)throw new Error("IPC required");
    await new Promise<void>((resolve,reject)=>process.send!({kind:"result",mode},error=>error?reject(error):resolve()));
  } finally { rmSync(root,{recursive:true,force:true}); }
}
main().catch(async error=>{if(process.send)await new Promise<void>(resolve=>process.send!({kind:"failure",message:error instanceof Error?error.stack:String(error)},()=>resolve()));process.exitCode=1;});
