import assert from "node:assert/strict";
import test from "node:test";
import { emptyCompanyBusinessInfo } from "./companyBusinessInfoTypes";
import { runCompanyBusinessInfoUpdatedAtBackfillCommand } from "./companyBusinessInfoUpdatedAtBackfillCommand";

// 일괄 반영일(서울 2026-11-03)에 찍힌 갱신 시각.
const BULK_AT = "2026-11-03T05:00:00.000Z";
const ORIGINAL_AT = "2026-10-26T02:54:59.000Z";

function fixture(current: Record<string, string | null>) {
  const writes: { companyId: string; updatedAt: string }[] = [];
  const repository = {
    async get(companyId: string) {
      if (!(companyId in current)) return null;
      return { ...emptyCompanyBusinessInfo(), businessInfoUpdatedAt: current[companyId] };
    },
    async update() { throw new Error("unexpected update"); },
    async setBusinessInfoUpdatedAt(companyId: string, updatedAt: Date) { writes.push({ companyId, updatedAt: updatedAt.toISOString() }); }
  };
  const input = JSON.stringify(["bulk", "edited", "done", "none", "gone"].map(companyId => ({ companyId, updatedAt: ORIGINAL_AT })));
  const dependencies = { repository: () => repository, readInput: async () => input, close: async () => {} };
  return { writes, dependencies };
}

const ARGS = ["--input=fixture.json", "--only-if-current-date=2026-11-03"];

test("일괄 반영일에 찍힌 기업만 원본 시각으로 바꾸고, 이후 직접 고친 기업은 보존한다", async () => {
  const { writes, dependencies } = fixture({
    bulk: BULK_AT,
    edited: "2026-11-10T01:00:00.000Z",
    done: ORIGINAL_AT,
    none: null
  });

  const dry = await runCompanyBusinessInfoUpdatedAtBackfillCommand(ARGS, () => {}, dependencies);
  assert.deepEqual(dry.counts, { candidate: 1, already: 1, changedSince: 2, missing: 1 });
  assert.equal(writes.length, 0);

  await assert.rejects(
    runCompanyBusinessInfoUpdatedAtBackfillCommand([...ARGS, "--apply"], () => {}, dependencies),
    /CONFIRMATION_REQUIRED/
  );
  assert.equal(writes.length, 0);

  const applied = await runCompanyBusinessInfoUpdatedAtBackfillCommand([...ARGS, "--apply", "--backup-confirmed"], () => {}, dependencies);
  assert.equal(applied.updatedCount, 1);
  assert.deepEqual(writes, [{ companyId: "bulk", updatedAt: ORIGINAL_AT }]);
  assert.deepEqual(applied.skipped.map(item => item.companyId).sort(), ["edited", "gone", "none"]);
});

test("입력 파일·날짜 조건이 없으면 실행하지 않는다", async () => {
  const { dependencies } = fixture({});
  await assert.rejects(runCompanyBusinessInfoUpdatedAtBackfillCommand(["--input=fixture.json"], () => {}, dependencies), /ARGUMENTS_REQUIRED/);
  await assert.rejects(runCompanyBusinessInfoUpdatedAtBackfillCommand(["--only-if-current-date=2026-11-03"], () => {}, dependencies), /ARGUMENTS_REQUIRED/);
});
