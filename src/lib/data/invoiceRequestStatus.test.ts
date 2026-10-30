import assert from "node:assert/strict";
import test from "node:test";
import { columnLetter, findColumns, loadInvoiceRequestStatuses, resetInvoiceRequestStatusCache, summarizeRequests } from "./invoiceRequestStatus";

test("응답 시트 헤더에서 타임스탬프·코스ID 열을 줄바꿈 섞인 긴 문구로도 찾는다", () => {
  const header = ["타임스탬프", "코스ID  \n\n(★ 백오피스 코스 ID를 꼭 정확히 기재 해 주세요)", "과정명", "수강생이름"];
  assert.deepEqual(findColumns(header), { timestamp: "A", courseId: "B" });
  assert.equal(findColumns(["타임스탬프", "과정명"]), null);
});

test("열 번호를 시트 열 문자로 바꾼다", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(columnLetter), ["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
});

test("같은 코스ID 요청은 건수를 세고 마지막 행을 최근 요청으로 본다", () => {
  const timestamps = [["2025. 1. 9 오전 9:28:35"], ["2025. 2. 1 오후 1:00:00"], ["2025. 3. 1 오전 10:00:00"], [""]];
  const courseIds = [["246877"], ["111111"], [" 246877.0 "], [""]];
  const byCourseId = summarizeRequests(timestamps, courseIds);
  assert.deepEqual(byCourseId.get("246877"), { lastRequestedAt: "2025. 3. 1 오전 10:00:00", requestCount: 2 });
  assert.deepEqual(byCourseId.get("111111"), { lastRequestedAt: "2025. 2. 1 오후 1:00:00", requestCount: 1 });
  assert.equal(byCourseId.size, 2);
});

test("시트 ID가 없으면 시트를 읽지 않고 not_configured로 알린다", async () => {
  const saved = process.env.INVOICE_REQUEST_SHEET_ID;
  delete process.env.INVOICE_REQUEST_SHEET_ID;
  resetInvoiceRequestStatusCache();
  try {
    assert.deepEqual(await loadInvoiceRequestStatuses(), { ok: false, reason: "not_configured" });
  } finally {
    resetInvoiceRequestStatusCache();
    if (saved !== undefined) process.env.INVOICE_REQUEST_SHEET_ID = saved;
  }
});
