/** Page-only frozen loader. Does not install/change the PG gate resolver.
 * Local runtime imports must resolve through frozen manifest edges. Only auth.ts
 * is replaced by the explicit platform-input seam; page/guard/presenters stay real.
 */
import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import ts from "typescript";
import { frozenBytes, verifyClosure } from "../../../.claude/plans/mongodb-drive-import-history/original/frozen-loader.fixture.ts";

export function installFrozenPageLoader(authURL: string) {
  const manifest = verifyClosure();
  const entries = new Map(manifest.files.map(entry => [entry.originPath, entry]));
  const urls = new Map<string, string>(), origins = new Map<string, string>();
  const loaded = new Set<string>(), seamEdges: string[] = [], violations: string[] = [];
  function urlFor(origin: string): string {
    const cached = urls.get(origin); if (cached) return cached;
    assert.ok(entries.has(origin), `Unregistered page closure: ${origin}`);
    const bytes = frozenBytes(origin).toString();
    const json = origin.endsWith(".json");
    const source = json ? bytes : origin.endsWith(".tsx")
      ? ts.transpileModule(bytes, { fileName: origin, compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022
      } }).outputText
      : stripTypeScriptTypes(bytes, { mode: "strip", sourceUrl: origin });
    const url = `data:${json ? "application/json" : "text/javascript"};base64,${Buffer.from(source).toString("base64")}#page-${encodeURIComponent(origin)}`;
    urls.set(origin, url); origins.set(url, origin); loaded.add(origin); return url;
  }
  const hook = registerHooks({ resolve(specifier, context, next) {
    const parent = origins.get(context.parentURL ?? "");
    if (!parent) return next(specifier, context);
    try {
      const edge = entries.get(parent)!.edges.find(item => item.specifier === specifier && !item.typeOnly);
      // Only the compiler-generated JSX runtime is additional to source imports.
      if (!edge && parent.endsWith(".tsx") && specifier === "react/jsx-runtime") {
        return next(specifier, { ...context, parentURL: import.meta.url });
      }
      assert.ok(edge, `Undeclared frozen page edge: ${parent} -> ${specifier}`);
      if (edge.target === "src/auth.ts") {
        seamEdges.push(`${parent} -> src/auth.ts`);
        return { url: authURL, shortCircuit: true };
      }
      if (edge.target) return { url: urlFor(edge.target), shortCircuit: true };
      assert.ok(edge.external && manifest.externalPackagesOrBuiltins.includes(specifier));
      return next(["next/navigation", "next/link", "next/cache", "next/server"].includes(specifier) ? `${specifier}.js` : specifier,
        { ...context, parentURL: import.meta.url });
    } catch (error) {
      violations.push(error instanceof Error ? error.message : "FROZEN_PAGE_EDGE_FAILED"); throw error;
    }
  } });
  return {
    load: <T>(origin: string): Promise<T> => import(urlFor(origin)) as Promise<T>,
    loaded, seamEdges, violations,
    close: () => hook.deregister()
  };
}
