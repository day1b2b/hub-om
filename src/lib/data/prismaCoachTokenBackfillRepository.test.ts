import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { backfillCoachAccessTokens } from "./coachAccessTokenBackfill";
import type { PrismaClient } from "@prisma/client";

let initialized = 0, disconnected = 0, fail = false;
const fakeDb = {
  async $transaction(run: (tx: unknown) => Promise<unknown>) {
    if (fail) throw new Error("synthetic-private-driver-value");
    return run({ coach: { async findMany() { return []; } } });
  },
  async $disconnect() { disconnected++; }
};
mock.module("./prisma", { namedExports: { getPrismaClient() { initialized++; return fakeDb; } } });
const { runCoachTokenBackfillCommand } = await import("./coachTokenBackfillCommand");

test("default CLI initializes env before PG and disconnects its client on success/failure", async () => {
  let loads = 0;
  const load = () => { assert.equal(initialized, loads); loads++; };
  assert.deepEqual((await runCoachTokenBackfillCommand([], load)).summary, { archivedTokens: 0, missingTokens: 0, changedTokens: 0, updatedTokens: 0 });
  assert.equal(disconnected, 1);
  fail = true;
  try { await assert.rejects(runCoachTokenBackfillCommand([], load), { message: "COACH_TOKEN_BACKFILL_FAILED" }); }
  finally { fail = false; }
  assert.equal(initialized, 2); assert.equal(disconnected, 2); assert.equal(loads, 2);
});

test("legacy direct-injection PG API leaves connection disposal to the caller", async () => {
  const before = disconnected;
  await backfillCoachAccessTokens(fakeDb as unknown as Pick<PrismaClient, "$transaction">, { apply: false });
  assert.equal(disconnected, before);
});
