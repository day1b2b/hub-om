// 기획서의 "활동 기록에 남는다" 규칙. route-policy.json이 "tracked"면
// src/lib/activity/coverage.test.ts가 그 입구가 withActivity로 감싸였는지 코드에서 확인한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const policy = JSON.parse(readFileSync("src/lib/activity/route-policy.json", "utf8")) as Record<string, string>;
const tracked = (entrance: string) => () => assert.equal(policy[entrance], "tracked", `${entrance}는 활동 기록 대상이어야 합니다.`);

for (const [spec, rule, entrance] of [
  ["operation-delete", "R7", "DELETE /api/operations/[operationId]"],
  ["operation-delete", "R7", "DELETE /api/admin/courses/[courseId]"],
  ["om-change", "R6", "PATCH /api/om-request/assign"],
  ["om-change", "R6", "POST /api/operations/[operationId]/drive-import/apply"],
  ["om-change", "R6", "PATCH /api/admin/database/cell"]
]) test(`요청이 활동 기록에 남는다 [spec:${spec} ${rule} | ${entrance}]`, tracked(entrance));
