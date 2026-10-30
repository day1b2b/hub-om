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
  assert.equal(manifest.baseline, "73a137ac8b8fe16bf6128b81529ab35d6de01031");
  for (const row of manifest.files) frozenBytes(row.originPath);
  for (const origin of ["package.json", "package-lock.json", "prisma/schema.prisma", "scripts/ts-loader.mjs"]) {
    const actual = createHash("sha256").update(readFileSync(new URL(`../../../../${origin}`, import.meta.url))).digest("hex");
    const approved = origin === "prisma/schema.prisma"
      ? new Set([entries.get(origin)!.sha256, "cb2dc13281d74c7e52c04fb65f7a2940f0c249a9fe9d301f049c22548b37c26c", "cfe8aa3ec3cc4d5c173229791cc16afafc1fd3636f3639d354f0c11052ef7ce7", "a357b1bb4ed0ed31147faff0417efe777adbb39c593be9266622f430266019e5", "dd93ad831ed676773ce9bc25df767f98ad39f4e1c22786d343e3bedca1896454", "1e33a1a6edc51fea1fdb2a4c5449075f8462ffc7d7c89ccd41e0a13d6bd45980", "eca2eb45d7aecfe5d29c38dea05f21e1b16e76dfb8ba1a9dfa305923a8b93138", "f5da3b4422e316f29660592231424e26136aae279a389f198c03f3f67f2b61b1"])
      : origin === "package.json"
        ? new Set([entries.get(origin)!.sha256, "e37e84bd72a5cd680e73ea886adb332aae037ed76819899be4edfc0eebf14339", "bb4e454e99c523037b906df304ec2beafa0a6c36353fff6f2fa6c7ae567be32f", "e19e695a4b84ff2515be736c5dda73d2757b40127e89611950fa88cd081a8703", "e19e695a4b84ff2515be736c5dda73d2757b40127e89611950fa88cd081a8703"])
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
export function installFrozenResolver() {
  if (installed) return;
  verifyClosure(); installed = true;
  registerHooks({ resolve(specifier, context, nextResolve) {
    const parent = origins.get(context.parentURL ?? "");
    if (!parent) return nextResolve(specifier, context);
    const edge = entries.get(parent)!.edges.find(row => row.specifier === specifier && !row.typeOnly);
    assert.ok(edge, `undeclared frozen edge: ${parent} -> ${specifier}`);
    if (edge.target) return { url: urlFor(edge.target), shortCircuit: true };
    assert.ok(edge.external && manifest.externalPackagesOrBuiltins.includes(specifier));
    return nextResolve(specifier, { ...context, parentURL: import.meta.url });
  } });
}
export async function frozen<T>(origin: string): Promise<T> { installFrozenResolver(); return import(urlFor(origin)) as Promise<T>; }
export const migrationNames = () => manifest.files.map(row => row.originPath).filter(value => /^prisma\/migrations\/.*\/migration\.sql$/.test(value)).sort();
