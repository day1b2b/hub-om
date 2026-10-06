import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarErrorMessage } from "./calendarErrors";

const safe = "갱신 계획 후 회차 또는 매핑이 변경되었습니다.";
const generic = "캘린더 작업을 처리하지 못했습니다.";

test("고정 진단만 정확히 허용하고 suffix·미등록 한국어·객체는 숨긴다", () => {
  assert.equal(calendarErrorMessage(new Error(safe)), safe);
  for (const error of [
    new Error(`${safe} private@example.test`),
    new Error(`민감 담당자 private@example.test`),
    new Error(`events.insert 실패(403): private-token`),
    Object.assign(new Error("private-token"), { code: "CALENDAR_LOCK_LOST" }),
    { message: safe, stack: "private-stack" },
    "private-token", null
  ]) assert.equal(calendarErrorMessage(error), generic);
});
