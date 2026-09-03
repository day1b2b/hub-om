import assert from "node:assert/strict";
import { test } from "node:test";

import { dropRequestsWithDeletedOperation } from "@/features/dashboard/orphanRequests.ts";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes.ts";

function req(id: string, courseId: string, operationId?: string): OmRequest {
  return { id, courseId, operationId, sessions: [] } as unknown as OmRequest;
}

const LIVE = [{ operationId: "op-live", courseId: "C-LIVE" }];

test("살아있는 운영과 짝인 요청은 남긴다", () => {
  const kept = dropRequestsWithDeletedOperation([req("a", "C-LIVE", "op-live")], LIVE);
  assert.deepEqual(kept.map((r) => r.id), ["a"]);
});

test("운영이 지워진 요청은 걷어낸다", () => {
  // 실제 증상: 운영 현황에서 지운 과정이 내 대시보드에만 남아 있었다.
  const kept = dropRequestsWithDeletedOperation([req("ghost", "C-GONE", "op-deleted")], LIVE);
  assert.deepEqual(kept, []);
});

test("운영이 아직 없는 접수 건은 남긴다", () => {
  const kept = dropRequestsWithDeletedOperation([req("new", "C-NEW", undefined), req("blank", "", "")], LIVE);
  assert.deepEqual(kept.map((r) => r.id), ["new", "blank"]);
});

test("operationId가 죽었어도 코스ID가 살아 있으면 남긴다", () => {
  // 운영이 다시 만들어졌거나 같은 과정의 다른 회차가 살아 있는 경우.
  const kept = dropRequestsWithDeletedOperation([req("recreated", "C-LIVE", "op-old")], LIVE);
  assert.deepEqual(kept.map((r) => r.id), ["recreated"]);
});

test("코스ID가 빈 요청은 코스ID로 살려 주지 않는다", () => {
  // ""를 키로 쓰면 코스ID 없는 요청이 전부 살아남아 걷어내는 의미가 없어진다.
  const kept = dropRequestsWithDeletedOperation([req("emptyCourse", "", "op-deleted")], [
    { operationId: "op-live", courseId: "" }
  ]);
  assert.deepEqual(kept, []);
});

test("살아있는 운영이 하나도 없으면 연결됐던 요청은 모두 걷어낸다", () => {
  const kept = dropRequestsWithDeletedOperation(
    [req("a", "C-1", "op-1"), req("b", "C-2", "op-2"), req("c", "C-3", undefined)],
    []
  );
  assert.deepEqual(kept.map((r) => r.id), ["c"]);
});

test("요청이 없으면 빈 배열", () => {
  assert.deepEqual(dropRequestsWithDeletedOperation([], LIVE), []);
});
