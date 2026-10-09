import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

interface Edge { specifier: string; target?: string; typeOnly: boolean; external?: boolean }
interface Entry { originPath: string; frozenPath: string; sha256: string; role: string; runtimeImports: string[]; edges: Edge[] }
const manifest = JSON.parse(readFileSync(new URL("./closure-manifest.txt", import.meta.url), "utf8")) as {
  baseline: string; roots: string[]; files: Entry[]; externalPackagesOrBuiltins: string[];
};
const entries = new Map(manifest.files.map(row => [row.originPath, row]));
export function frozenBytes(origin: string) {
  const entry = entries.get(origin); assert.ok(entry, `unregistered frozen file: ${origin}`);
  const bytes = readFileSync(new URL(entry.frozenPath, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, origin);
  return bytes;
}
export function verifyClosure() {
  assert.equal(manifest.baseline, "093f585b444197c6b0442a3880469fd0d6a0502b");
  for (const row of manifest.files) frozenBytes(row.originPath);
  for (const origin of ["package.json", "package-lock.json", "prisma/schema.prisma", "scripts/ts-loader.mjs"]) {
    const actual = createHash("sha256").update(readFileSync(new URL(`../../../../${origin}`, import.meta.url))).digest("hex");
    const approved = origin === "prisma/schema.prisma"
      ? new Set([entries.get(origin)!.sha256, "bf3c956c6e78ac5cad4c869bb0da0e82bc84ed171b339726c8a8b2574ab257b1", "0a9358ca6f01ee0823744f5aad9e5e1166162ecdecbac425c5085e7dfc845e79"])
      : origin === "package.json"
        ? new Set([entries.get(origin)!.sha256, "db7b820da07179e8bb496b16cc29d4eb7ce6008001a499d17e49ae2b927aecf9"])
        : origin === "package-lock.json"
          ? new Set([entries.get(origin)!.sha256, "d0f363d9567760347fd1b342be55e93db815e436a719bc3fc8db27489dc636c2"])
          : new Set([entries.get(origin)!.sha256]);
    assert.ok(approved.has(actual), `actual runtime drift: ${origin}`);
  }
  return manifest;
}
const urls = new Map<string, string>(), origins = new Map<string, string>();
function urlFor(origin: string): string {
  const cached = urls.get(origin); if (cached) return cached;
  assert.ok(!origin.endsWith(".tsx"), "page bytes are frozen; JSX page execution is a later oracle, not this PG gate");
  const bytes = frozenBytes(origin), json = origin.endsWith(".json");
  const source = json ? bytes.toString() : stripTypeScriptTypes(bytes.toString(), { mode: "strip", sourceUrl: origin });
  const url = `data:${json ? "application/json" : "text/javascript"};base64,${Buffer.from(source).toString("base64")}#${encodeURIComponent(origin)}`;
  urls.set(origin, url); origins.set(url, origin); return url;
}
let installed = false;
export function installFrozenResolver(authURL?: string) {
  if (installed) return;
  verifyClosure(); installed = true;
  registerHooks({ resolve(specifier, context, nextResolve) {
    const parent = origins.get(context.parentURL ?? "");
    if (!parent) return nextResolve(specifier, context);
    const edge = entries.get(parent)!.edges.find(row => row.specifier === specifier && !row.typeOnly);
    assert.ok(edge, `undeclared frozen edge: ${parent} -> ${specifier}`);
    if (edge.target === "src/auth.ts" && authURL) return { url: authURL, shortCircuit: true };
    if (edge.target) return { url: urlFor(edge.target), shortCircuit: true };
    assert.ok(edge.external && manifest.externalPackagesOrBuiltins.includes(specifier));
    return nextResolve(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, { ...context, parentURL: import.meta.url });
  } });
}
export async function frozen<T>(origin: string): Promise<T> { installFrozenResolver(); return import(urlFor(origin)) as Promise<T>; }
export const migrationNames = () => manifest.files.map(row => row.originPath).filter(value => /^prisma\/migrations\/.*\/migration\.sql$/.test(value)).sort();
