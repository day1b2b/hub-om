import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import { runOnsiteRequiredBackfillCommand } from "./onsiteRequiredBackfillCommand";

function repository(targetCount: number, updatedCount: number, fail = false) {
  let applies = 0;
  const value: OperationBackfillRepository = {
    async countOnsiteRequiredTargets() { if (fail) throw new Error("private canary"); return targetCount; },
    async applyOnsiteRequiredBackfill() { applies++; return updatedCount; },
    async countOmAssignmentStatusTargets() { throw new Error("unexpected"); },
    async applyOmAssignmentStatusBackfill() { throw new Error("unexpected"); },
  };
  return { value, applyCount: () => applies };
}

test("onsite backfill command preserves dry-run/apply and scoped jobs never load env", async () => {
  const load = () => { throw new Error("unexpected environment access"); };
  const dry = repository(3, 2), apply = repository(3, 2);
  assert.deepEqual(await runWithDataRepositories({ operationBackfill: dry.value }, () => runOnsiteRequiredBackfillCommand([], load)), { apply: false, targetCount: 3, updatedCount: 0 });
  assert.equal(dry.applyCount(), 0);
  assert.deepEqual(await runWithDataRepositories({ operationBackfill: apply.value }, () => runOnsiteRequiredBackfillCommand(["--apply", "ignored"], load)), { apply: true, targetCount: 3, updatedCount: 2 });
  assert.equal(apply.applyCount(), 1);
});

test("onsite backfill command closes only its default PG repository on success and failure", async () => {
  for (const fail of [false, true]) {
    const fixture = repository(1, 1, fail); let loaded = 0, closed = 0;
    const command = runOnsiteRequiredBackfillCommand([], () => { loaded++; }, { getDefaultRepository: () => fixture.value, closeDefaultRepository: async () => { closed++; } });
    if (fail) await assert.rejects(command, /^Error: ONSITE_REQUIRED_BACKFILL_FAILED$/); else assert.deepEqual(await command, { apply: false, targetCount: 1, updatedCount: 0 });
    assert.equal(loaded, 1); assert.equal(closed, 1);
  }
  const fixture = repository(1, 1); let closed = 0;
  await runWithDataRepositories({ operationBackfill: fixture.value }, () => runOnsiteRequiredBackfillCommand([], () => {}, { getDefaultRepository: () => fixture.value, closeDefaultRepository: async () => { closed++; } }));
  assert.equal(closed, 0);
});

test("onsite backfill command fails closed without leaking repository errors", async () => {
  await assert.rejects(
    runWithDataRepositories({ operationBackfill: repository(0, 0, true).value }, () => runOnsiteRequiredBackfillCommand([], () => {})),
    error => error instanceof Error && error.message === "ONSITE_REQUIRED_BACKFILL_FAILED" && !error.message.includes("canary"),
  );
});

for (const scenario of ["dry-run", "apply", "failure"] as const) {
  test(`real onsite backfill CLI ${scenario} preserves counts-only output without env access`, () => {
    const args = scenario === "apply" ? ["--apply"] : [];
    const source = `
      import {mock} from 'node:test';
      mock.module('dotenv',{namedExports:{config(){process.stderr.write('UNEXPECTED_ENV');throw Error('blocked');}}});
      const {runWithDataRepositories}=await import('./src/lib/data/dataRepositoryContext.ts');
      process.argv=['node','script',...${JSON.stringify(args)}];
      const repo={async countOnsiteRequiredTargets(){${scenario === "failure" ? "throw Error('private-canary');" : "return 3;"}},async applyOnsiteRequiredBackfill(){return 2;},async countOmAssignmentStatusTargets(){throw Error('unexpected');},async applyOmAssignmentStatusBackfill(){throw Error('unexpected');}};
      await runWithDataRepositories({operationBackfill:repo},()=>import('./scripts/backfill-onsite-required-y.ts'));
    `;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-test-module-mocks", "--experimental-loader", "./scripts/ts-loader.mjs", "--input-type=module", "-e", source], {
      cwd: process.cwd(), encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", NODE_ENV: "test" },
    });
    assert.equal(result.error, undefined); assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_ENV|private-canary|Error:|\bat .*\(/);
    const mode = `[backfill-onsite-required-y] 모드: ${scenario === "apply" ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}\n`;
    if (scenario === "failure") { assert.equal(result.status, 1); assert.equal(result.stdout, mode); assert.match(result.stderr, /^\[backfill-onsite-required-y\] 실패\./); }
    else {
      assert.equal(result.status, 0); assert.equal(result.stderr, "");
      assert.equal(result.stdout, mode + (scenario === "apply"
        ? "[backfill-onsite-required-y] apply: 2건 갱신 (대상 3건)\n"
        : "[backfill-onsite-required-y] dry-run: onsite_required != 'Y' 대상 3건 -> 'Y'로 변경 예정\n"));
    }
  });
}
