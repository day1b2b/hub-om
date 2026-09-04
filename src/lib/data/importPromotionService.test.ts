import assert from "node:assert/strict";
import { test } from "node:test";

import { SourceTeam } from "@prisma/client";
import { stableOperationId } from "@/lib/data/importPromotionService.ts";

test("같은 지문이면 항상 같은 operationId가 나온다", () => {
  // 이 결정성이 재반영을 알아보게 해 주지만, operation_id가 @unique라서
  // 삭제된 운영과 같은 지문을 다시 반영하면 유니크 충돌이 난다.
  // 그래서 중복 검사가 삭제된 것까지 찾아야 한다.
  const a = stableOperationId(SourceTeam.TEAM_1, "abc123def456789");
  const b = stableOperationId(SourceTeam.TEAM_1, "abc123def456789");
  assert.equal(a, b);
});

test("지문이 다르면 다른 operationId가 나온다", () => {
  const a = stableOperationId(SourceTeam.TEAM_1, "abc123def456789");
  const b = stableOperationId(SourceTeam.TEAM_1, "zzz999yyy888777");
  assert.notEqual(a, b);
});

test("팀이 다르면 다른 operationId가 나온다", () => {
  const a = stableOperationId(SourceTeam.TEAM_1, "abc123def456789");
  const b = stableOperationId(SourceTeam.TEAM_2, "abc123def456789");
  assert.notEqual(a, b);
});

test("지문 앞 12자만 대문자로 쓴다", () => {
  assert.equal(stableOperationId(SourceTeam.TEAM_1, "abc123def456789"), "SRC-TEAM1-ABC123DEF456");
});

test("지문이 없으면 매번 다른 값이 나온다", () => {
  // 재반영을 알아볼 근거가 없으므로 새로 만드는 쪽이 맞다.
  const a = stableOperationId(SourceTeam.TEAM_1, null);
  const b = stableOperationId(SourceTeam.TEAM_1, null);
  assert.notEqual(a, b);
  assert.match(a, /^SRC-TEAM1-[0-9A-F]{12}$/);
});
