import assert from "node:assert/strict";
import test from "node:test";
import { SourceTeam } from "@prisma/client";
import { assertSafeSourceOnlyPromotionDatabase, parseSourceOnlyPromotionArgs, runSourceOnlyPromotionCommand } from "./sourceOnlyPromotionCommand";

test("source-only promotion arguments keep the legacy team default and require apply confirmations", () => {
  assert.deepEqual(parseSourceOnlyPromotionArgs([]), { apply: false, sourceTeam: SourceTeam.TEAM_1 });
  assert.deepEqual(parseSourceOnlyPromotionArgs(["team_2", "--dry-run"]), { apply: false, sourceTeam: SourceTeam.TEAM_2 });
  assert.deepEqual(parseSourceOnlyPromotionArgs(["unknown", "--apply", "--backup-confirmed", "--maintenance-confirmed"]), { apply: true, sourceTeam: SourceTeam.UNKNOWN });
  for (const args of [["other"], ["team_1", "team_2"], ["--apply"], ["--dry-run", "--apply"], ["--unknown"]]) {
    assert.throws(() => parseSourceOnlyPromotionArgs(args), /SOURCE_ONLY_PROMOTION_FAILED/);
  }
});

test("source-only promotion preserves the local PostgreSQL gate and closes once", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) assert.doesNotThrow(() => assertSafeSourceOnlyPromotionDatabase(`postgresql://fixture@${host}:5432/test`, undefined));
  assert.doesNotThrow(() => assertSafeSourceOnlyPromotionDatabase("postgresql://fixture@db.example.invalid/test", "true"));
  assert.throws(() => assertSafeSourceOnlyPromotionDatabase("postgresql://fixture@db.example.invalid/test", undefined), /SOURCE_ONLY_PROMOTION_FAILED/);
  const prior = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgresql://fixture@127.0.0.1:5432/test";
  let loaded = 0, closed = 0, called = 0;
  try {
    const output = await runSourceOnlyPromotionCommand(["team_1"], () => { loaded++; }, {
      getDefaultRepository: () => ({ async promoteSourceOnlyRows(team, apply) {
        called++; assert.equal(team, SourceTeam.TEAM_1); assert.equal(apply, false);
        return { sourceRows: 2, promoted: 1, linkedExisting: 1, blocked: 0, blockedReasons: {} };
      } }),
      closeDefaultRepository: async () => { closed++; }
    });
    assert.equal(output.result.sourceRows, 2); assert.equal(loaded, 1); assert.equal(called, 1); assert.equal(closed, 1);
  } finally { if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior; }
});

test("source-only promotion distinguishes cleanup failure after completion", async () => {
  const prior = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgresql://fixture@127.0.0.1:5432/test";
  try {
    await assert.rejects(runSourceOnlyPromotionCommand([], () => {}, {
      getDefaultRepository: () => ({ async promoteSourceOnlyRows() { return { sourceRows: 0, promoted: 0, linkedExisting: 0, blocked: 0, blockedReasons: {} }; } }),
      closeDefaultRepository: async () => { throw new Error("private canary"); }
    }), /^Error: SOURCE_ONLY_PROMOTION_CLEANUP_FAILED$/);
  } finally { if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior; }
});
