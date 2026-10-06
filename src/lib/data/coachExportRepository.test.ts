import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
const calls: Array<[string, unknown]> = [];
const rows = [{ id: "synthetic", name: "Synthetic", accessToken: null, privateProfile: null }];
let rejectAudit = false;
const tx = { coach: { findMany: async (args: unknown) => { calls.push(["read", args]); return rows; } }, coachPrivateAccessLog: { createMany: async (args: unknown) => { calls.push(["audit", args]); if (rejectAudit) throw new Error("audit unavailable"); } } };
mock.module("./prisma", { namedExports: { getPrismaClient: () => ({ $transaction: async (work: (value: typeof tx) => unknown, options: unknown) => { calls.push(["transaction", options]); return work(tx); } }) } });
const { createCoachExportRepository } = await import("./coachExportRepositoryFactory");
test("PG export keeps filtered/sorted query and awaits audit within transaction", async () => {
  calls.length = 0;
  const repo = createCoachExportRepository();
  assert.deepEqual(await repo.exportCoaches(["synthetic", "synthetic"], "email", "synthetic@example.invalid"), rows);
  assert.deepEqual(calls.map(call => call[0]), ["transaction", "read", "audit"]);
  assert.deepEqual(calls[1][1], { where: { id: { in: ["synthetic"] }, deletedAt: null }, select: { id: true, name: true, accessToken: true, privateProfile: { select: { phone: true, email: true } } }, orderBy: { normalizedName: "asc" } });
  assert.deepEqual(calls[2][1], { data: [{ coachId: "synthetic", accessedByEmail: "synthetic@example.invalid", context: "coach_export:email" }] });
  rejectAudit = true;
  try { await assert.rejects(repo.exportCoaches(["synthetic"], "phone", "synthetic@example.invalid"), /audit unavailable/); }
  finally { rejectAudit = false; }
});
test("explicit export context never falls back to PG", async () => {
  calls.length = 0;
  await runWithDataRepositories({ coachExport: { exportCoaches: async () => [] } }, async () => assert.deepEqual(await createCoachExportRepository().exportCoaches([], "phone", "synthetic@example.invalid"), []));
  assert.throws(() => runWithDataRepositories({}, createCoachExportRepository), /DATA_REPOSITORY_NOT_CONFIGURED/);
  assert.equal(calls.length, 0);
});
