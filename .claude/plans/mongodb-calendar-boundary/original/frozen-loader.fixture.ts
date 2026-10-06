import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import path from "node:path";

interface Entry { originPath: string; sha256: string; runtimeImports: string[]; role: string }
const manifest = JSON.parse(readFileSync(new URL("./closure-manifest.txt", import.meta.url), "utf8")) as {
  baseline: string; snapshotManifestCount: number; files: Entry[]; roots: string[]; externalPackagesOrBuiltins: string[];
};
const entries = new Map(manifest.files.map(row => [row.originPath, row]));
const urls = new Map<string, string>(), origins = new Map<string, string>();
export function frozenBytes(origin: string): Buffer {
  const entry = entries.get(origin); assert.ok(entry, `unregistered frozen file: ${origin}`);
  const bytes = readFileSync(new URL(`./${origin}.txt`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, origin);
  return bytes;
}
export function verifyClosure() {
  assert.equal(manifest.baseline, "8238647961bebe3545128fc95f017881ace7d404");
  assert.equal(manifest.snapshotManifestCount, 919);
  for (const row of manifest.files) frozenBytes(row.originPath);
  return manifest;
}
function urlFor(origin: string): string {
  if (urls.has(origin)) return urls.get(origin)!;
  const bytes = frozenBytes(origin);
  const json = origin.endsWith(".json");
  const source = json ? bytes.toString() : stripTypeScriptTypes(bytes.toString(), { mode: "strip", sourceUrl: origin });
  const url = `data:${json ? "application/json" : "text/javascript"};base64,${Buffer.from(source).toString("base64")}#${encodeURIComponent(origin)}`;
  urls.set(origin, url); origins.set(url, origin); return url;
}
let installed = false;
export function installFrozenResolver() {
  if (installed) return;
  verifyClosure(); installed = true;
  registerHooks({ resolve(specifier, context, nextResolve) {
    const parent = origins.get(context.parentURL ?? "");
    if (!parent) return nextResolve(specifier, context);
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const stem = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(parent), specifier));
      const target = [stem, `${stem}.ts`, `${stem}/index.ts`].find(value => entries.has(value));
      assert.ok(target, `frozen resolver escaped closure: ${parent} -> ${specifier}`);
      assert.ok(entries.get(parent)!.runtimeImports.includes(target), `undeclared frozen edge ${parent} -> ${target}`);
      return { url: urlFor(target), shortCircuit: true };
    }
    assert.ok(manifest.externalPackagesOrBuiltins.includes(specifier), `unregistered external ${specifier}`);
    return nextResolve(specifier, { ...context, parentURL: import.meta.url });
  } });
}
export async function frozen<T>(origin: string): Promise<T> {
  installFrozenResolver(); return import(urlFor(origin)) as Promise<T>;
}
export const migrationNames = () => manifest.files.map(row => row.originPath).filter(value => /^prisma\/migrations\/.*\/migration\.sql$/.test(value)).sort();
