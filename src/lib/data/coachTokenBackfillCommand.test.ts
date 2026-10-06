import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { getCoachTokenBackfillRepository } from "./coachTokenBackfillRepositoryFactory";
import { PrismaCoachTokenBackfillRepository } from "./prismaCoachTokenBackfillRepository";
import { runCoachTokenBackfillCommand } from "./coachTokenBackfillCommand";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { CoachTokenBackfillRepository } from "./coachTokenBackfillRepository";

const empty = { archivedTokens: 0, missingTokens: 0, changedTokens: 0, updatedTokens: 0 };
test("backfill defaults to PG and scoped commands isolate parallel/nested jobs without loading env", async () => {
  assert.ok(getCoachTokenBackfillRepository() instanceof PrismaCoachTokenBackfillRepository);
  const a: CoachTokenBackfillRepository = { async backfill(options) { assert.equal(options.apply, false); return empty; } };
  const b: CoachTokenBackfillRepository = { async backfill() { return { ...empty, archivedTokens: 1 }; } };
  const neverEnv = () => { throw new Error("Unexpected environment access"); };
  await Promise.all([a, b].map(repo => runWithDataRepositories({ coachTokenBackfill: repo }, async () => {
    await Promise.resolve(); assert.equal(getCoachTokenBackfillRepository(), repo);
    await runWithDataRepositories({ coachTokenBackfill: b }, async () => assert.equal(getCoachTokenBackfillRepository(), b));
    assert.equal(getCoachTokenBackfillRepository(), repo);
    assert.deepEqual((await runCoachTokenBackfillCommand([], neverEnv)).summary, await repo.backfill({ apply: false }));
  })));
  await assert.rejects(runWithDataRepositories({}, () => runCoachTokenBackfillCommand([], neverEnv)), /DATA_REPOSITORY_NOT_CONFIGURED/);
});

test("invalid/unconfirmed options reject before environment or backend calls; failures redact secrets", async () => {
  let calls = 0;
  const repo: CoachTokenBackfillRepository = { async backfill() { calls++; throw new Error("synthetic-private-token"); } };
  const load = () => { throw new Error("Environment must not load"); };
  for (const args of [["--wrong"], ["--apply"], ["--apply", "--backup-confirmed"], ["--apply", "--dry-run"]]) {
    await assert.rejects(runWithDataRepositories({ coachTokenBackfill: repo }, () => runCoachTokenBackfillCommand(args, load)), /Invalid backfill arguments|Apply requires/);
  }
  assert.equal(calls, 0);
  await assert.rejects(runWithDataRepositories({ coachTokenBackfill: repo }, () => runCoachTokenBackfillCommand([], load)), { message: "COACH_TOKEN_BACKFILL_FAILED" });
  assert.equal(calls, 1);
});

// Real CLI entry in a fresh process. Environment loader and Prisma are tripwires;
// scoped backend is synthetic, and this verifies wiring/output rather than DB behavior.
for (const scenario of ["dry-run", "apply", "failure", "missing", "invalid"] as const) {
  test(`real backfill CLI ${scenario} keeps counts-only output and never touches production env/PG`, () => {
    const args = scenario === "apply" ? ["--apply", "--backup-confirmed", "--maintenance-confirmed"] : scenario === "invalid" ? ["--invalid"] : [];
    const source = `
      import {mock} from 'node:test';
      mock.module('@next/env',{defaultExport:{loadEnvConfig(){process.stderr.write('UNEXPECTED_ENV');throw Error('blocked');}}});
      mock.module('./src/lib/data/prisma.ts',{namedExports:{getPrismaClient(){process.stderr.write('UNEXPECTED_PG');throw Error('blocked');}}});
      const {runWithDataRepositories}=await import('./src/lib/data/dataRepositoryContext.ts');
      process.argv=['node','script',...${JSON.stringify(args)}];
      const repo={async backfill(options){${scenario === "failure" ? "throw Error('synthetic-private-token');" : `return {archivedTokens:2,missingTokens:1,changedTokens:1,updatedTokens:options.apply?1:0};`}}};
      await runWithDataRepositories(${scenario === "missing" ? "{}" : "{coachTokenBackfill:repo}"},()=>import('./scripts/backfill-coach-access-tokens.ts'));
    `;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-test-module-mocks", "--experimental-loader", "./scripts/ts-loader.mjs", "--input-type=module", "-e", source], {
      cwd: process.cwd(), encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", NODE_ENV: "test" }
    });
    assert.equal(result.error, undefined);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_|synthetic-private-token|Error:|\bat .*\(/);
    if (scenario === "dry-run" || scenario === "apply") {
      assert.equal(result.status, 0); assert.equal(result.stderr, "");
      assert.equal(result.stdout, `[backfill-coach-access-tokens] ${scenario} 완료: 아카이브 토큰 2건 / 신규 1건 / 변경 필요 1건 / 업데이트 ${scenario === "apply" ? 1 : 0}건\n`);
    } else {
      assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /^\[backfill-coach-access-tokens\] 실패\./);
    }
  });
}
