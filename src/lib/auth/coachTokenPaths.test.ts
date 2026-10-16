import assert from "node:assert/strict";
import { test } from "node:test";
import { isCoachTokenPath } from "./coachTokenPaths.ts";

test("코치 개인 링크 경로만 세션 없이 통과한다", () => {
  assert.equal(isCoachTokenPath("/coach"), true);
  assert.equal(isCoachTokenPath("/api/coach/me"), true);
  assert.equal(isCoachTokenPath("/api/coach/schedule/2026-11"), true);
});

test("직원용 코치 관리 경로는 세션이 필요하다", () => {
  for (const pathname of [
    "/coaches",
    "/coaches/admin",
    "/coaches/schedule",
    "/api/coaches",
    "/api/coaches/abc/regenerate-token",
    "/api/coaches/export",
    "/coach/other",
    "/api/coach",
    "/api/coach/schedule",
    "/api/coach/schedule/2026-11/extra",
    "/api/admin/schedule-registration/2026-11"
  ]) {
    assert.equal(isCoachTokenPath(pathname), false, pathname);
  }
});
