import assert from "node:assert/strict";
import test from "node:test";
import { classifyDatabaseChange, missingLabels } from "./check-database-change-review.mjs";

test("일반 화면 변경은 DB 검토 대상이 아니다", () => {
  const result = classifyDatabaseChange(["src/app/dashboard/page.tsx"], "+const title = '대시보드';");
  assert.deepEqual(result, { requiresReview: false, requiresCutoverApproval: false });
});

test("DB 연결과 MongoDB 경로 변경은 책임자 검토가 필요하다", () => {
  const result = classifyDatabaseChange(["src/lib/mongodb/connection.ts"], "+const uri = process.env.MONGODB_URI;");
  assert.equal(result.requiresReview, true);
  assert.equal(result.requiresCutoverApproval, false);
  assert.deepEqual(missingLabels(result, new Set()), ["database-change-reviewed"]);
});

test("MongoDB selector 활성화는 전환 승인도 필요하다", () => {
  const result = classifyDatabaseChange([".env.example"], "+OPERATION_WRITE_BACKEND=mongodb-shadow");
  assert.deepEqual(result, { requiresReview: true, requiresCutoverApproval: true });
  assert.deepEqual(missingLabels(result, new Set(["database-change-reviewed"])), ["database-cutover-approved"]);
});

test("두 승인 라벨이 있으면 차단하지 않는다", () => {
  const result = { requiresReview: true, requiresCutoverApproval: true };
  const labels = new Set(["database-change-reviewed", "database-cutover-approved"]);
  assert.deepEqual(missingLabels(result, labels), []);
});
