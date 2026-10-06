/** Preload for the unchanged actual script entry. Actual command/factory/PG
 * repository/retention/dotenv; cached Prisma IO is synthetic, NOT native evidence.
 * This file is loaded only in an isolated child with an owned synthetic cwd.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { basename, join, resolve } from "node:path";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import pg from "pg";

const mode = process.env.PRUNE_CLI_MODE;
assert.ok(mode && ["success", "empty", "partial-error", "nonerror", "close-error", "missing-key", "import"].includes(mode), "PRUNE_PRELOAD_MODE_INVALID");
assert.ok(process.env.PRUNE_CLI_CWD, "PRUNE_PRELOAD_CWD_MISSING");
const cwd = fs.realpathSync(process.env.PRUNE_CLI_CWD);
assert.equal(fs.realpathSync(process.cwd()), cwd, "PRUNE_PRELOAD_CWD_MISMATCH");
assert.match(basename(cwd), /^hub-om-prune-cli-[A-Za-z0-9]+$/, "PRUNE_PRELOAD_CWD_NOT_OWNED");
const record = (event: string, value: unknown = null) => fs.appendFileSync(join(cwd, "observer.jsonl"), `${JSON.stringify({ event, value })}\n`);
const fail = () => new Error("synthetic-prune-private@example.invalid", { cause: new Error("mongodb://synthetic:private-key@127.0.0.1:1/private-prune") });
const forbidden = (kind: string): never => { record("forbidden", kind); throw fail(); };
const root = new URL("../../../../", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, next) {
  // The repository's async loader is cwd-based. Keep synthetic cwd for dotenv,
  // while resolving real source aliases against the checkout, not a copied tree.
  if (specifier.startsWith("@/") && context.parentURL?.startsWith(root.href)) {
    for (const suffix of [".ts", "/index.ts"]) {
      const target = new URL(`src/${specifier.slice(2)}${suffix}`, root);
      if (fs.existsSync(target)) return { url: target.href, shortCircuit: true };
    }
  }
  return next(specifier, context);
} });
const originalRead = fs.readFileSync;
mock.method(fs, "readFileSync", ((...args: Parameters<typeof fs.readFileSync>) => {
  const path = typeof args[0] === "string" ? resolve(args[0]) : null;
  if (path && [".env.local", ".env"].includes(basename(path))) {
    if (path !== join(cwd, basename(path))) return forbidden("foreign-env");
    record("env-read", basename(path));
  }
  return originalRead(...args);
}) as typeof fs.readFileSync);
mock.method(pg.Client.prototype, "connect", () => forbidden("pg-client"));
mock.method(pg.Pool.prototype, "connect", () => forbidden("pg-pool"));
mock.method(globalThis, "fetch", async () => forbidden("http"));
const stdout = console.log.bind(console), stderr = console.error.bind(console);
mock.method(console, "log", (...args: unknown[]) => { record("stdout", args); stdout(...args); });
mock.method(console, "error", (...args: unknown[]) => { record("stderr", args); stderr(...args); });
let batch = 0;
const schedule = mode === "empty" ? [[0, 0]] : [[1000, 1], [0, 1000], [4, 2]];
const globals = globalThis as typeof globalThis & { prisma?: unknown };
assert.equal(globals.prisma, undefined, "PRUNE_PRELOAD_CACHED_CLIENT_PRESENT");
globals.prisma = new Proxy({}, { get(_target, name) {
  if (name === "$disconnect") return async () => { record("close"); if (mode === "close-error") throw fail(); };
  if (name === "$transaction") return async (work: (tx: object) => Promise<unknown>, options: unknown) => {
    const current = batch++;
    record("transaction", { batch: current, options, env: Object.fromEntries([
      "PRUNE_ORDER", "PRUNE_INHERITED", "PRUNE_BASE_ONLY", "PRUNE_DOUBLE", "PRUNE_SINGLE", "PRUNE_MULTILINE", "PRUNE_EMPTY"
    ].map(key => [key, process.env[key] ?? null])) });
    if (!schedule[current]) return forbidden("excess-batch");
    let deletion = 0;
    const result = await work(new Proxy({}, { get(_tx, member) {
      if (member !== "$executeRaw") return forbidden("unexpected-transaction-member");
      return async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const index = deletion++;
        record("delete", { batch: current, index, parts: Array.from(parts), raw: parts.raw ? Array.from(parts.raw) : null, values });
        if (index > 1) return forbidden("excess-delete");
        if (mode === "partial-error" && current === 1 && index === 1) throw fail();
        if (mode === "nonerror") throw { detail: "synthetic-prune-private@example.invalid", cause: "private-key" };
        return schedule[current][index];
      };
    } }));
    record("transaction-return", result); return result;
  };
  return forbidden("unexpected-client-member");
} });
process.once("exit", code => {
  record("exit", code); hooks.deregister(); mock.restoreAll(); delete globals.prisma;
});
record("preload-ready");
