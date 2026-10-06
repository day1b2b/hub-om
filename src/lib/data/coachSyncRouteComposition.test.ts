import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";

const sentinel = new Error("SYNTHETIC_COACH_SYNC_COMPOSITION");
let compositionCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => null } });
mock.module("@/lib/data/coachSyncComposition", { namedExports: { runCoachSyncRequest: async () => { compositionCalls++; throw sentinel; } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const routes = await Promise.all([
  import("../../app/api/admin/sync-notion/route"),
  import("../../app/api/sync/engagements/route"),
  import("../../app/api/sync/samsung-schedule/route"),
  import("../../app/api/sync/all/route")
]);
hooks.deregister();

test("all coach sync route exports enter the shared composition boundary", async () => {
  for (const [index, route] of routes.entries()) {
    for (const method of ["GET", "POST"] as const) {
      await assert.rejects(route[method](new Request(`https://example.invalid/api/sync/${index}`, { method })), error => error === sentinel);
    }
  }
  assert.equal(compositionCalls, 8);
});
