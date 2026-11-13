import assert from "node:assert/strict";
import test from "node:test";
import { columnLetter, findColumns, loadInvoiceRequestStatuses, parseWebAppRows, resetInvoiceRequestStatusCache, summarizeRequests } from "./invoiceRequestStatus";

test("응답 시트 헤더에서 타임스탬프·코스ID 열을 줄바꿈 섞인 긴 문구로도 찾는다", () => {
  const header = ["타임스탬프", "코스ID  \n\n(★ 백오피스 코스 ID를 꼭 정확히 기재 해 주세요)", "과정명", "수강생이름"];
  assert.deepEqual(findColumns(header), { timestamp: "A", courseId: "B", issueStatus: null, issuedAt: null, paidAt: null });
  assert.equal(findColumns(["타임스탬프", "과정명"]), null);
});

test("처리 결과 열(실제입금일자·발급일자·발급여부)도 찾고, 발급자·작성일자와 헷갈리지 않는다", () => {
  const header = ["타임스탬프", "코스ID", "과정명", "실제입금일자", "작성일자", "발급일자", "발급자", "발급여부", "요청사항 (이전 버전)"];
  assert.deepEqual(findColumns(header), { timestamp: "A", courseId: "B", issueStatus: "H", issuedAt: "F", paidAt: "D" });
});

test("열 번호를 시트 열 문자로 바꾼다", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(columnLetter), ["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
});

test("같은 코스ID 요청은 건수를 세고 마지막 행을 최근 요청으로 본다", () => {
  const timestamps = [["2025. 1. 9 오전 9:28:35"], ["2025. 2. 1 오후 1:00:00"], ["2025. 3. 1 오전 10:00:00"], [""]];
  const courseIds = [["246877"], ["111111"], [" 246877.0 "], [""]];
  const byCourseId = summarizeRequests({ timestamps, courseIds });
  assert.deepEqual(byCourseId.get("246877"), { lastRequestedAt: "2025. 3. 1 오전 10:00:00", requestCount: 2, issueStatus: "", issuedAt: "", paidAt: "" });
  assert.deepEqual(byCourseId.get("111111"), { lastRequestedAt: "2025. 2. 1 오후 1:00:00", requestCount: 1, issueStatus: "", issuedAt: "", paidAt: "" });
  assert.equal(byCourseId.size, 2);
});

test("처리 결과는 같은 코스ID의 최근 행 값을 쓰고, 끝이 잘린 열은 빈 값으로 둔다", () => {
  const byCourseId = summarizeRequests({
    timestamps: [["2025. 1. 9 오전 9:28:35"], ["2025. 1. 9 오후 1:40:34"], ["2025. 2. 1 오전 9:00:00"]],
    courseIds: [["246877"], ["246877"], ["111111"]],
    issueStatuses: [["발급완료"], [" 발급완료 "]],
    issuedAts: [["2025. 1. 9"], ["2025. 1. 10"]],
    paidAts: [["취소(1/9)"], ["2025.02.05"]]
  });
  assert.deepEqual(byCourseId.get("246877"), {
    lastRequestedAt: "2025. 1. 9 오후 1:40:34", requestCount: 2, issueStatus: "발급완료", issuedAt: "2025. 1. 10", paidAt: "2025.02.05"
  });
  assert.deepEqual(byCourseId.get("111111"), {
    lastRequestedAt: "2025. 2. 1 오전 9:00:00", requestCount: 1, issueStatus: "", issuedAt: "", paidAt: ""
  });
});

test("웹앱 응답 행을 코스ID별 현황으로 바꾸고, 모양이 다르면 null", () => {
  const byCourseId = parseWebAppRows({
    ok: true,
    rows: [
      ["2025. 1. 9 오전 9:28:35", "246877", "", "", ""],
      ["2025. 1. 9 오후 1:40:34", "246877", "발급완료", "2025. 1. 10", "2025.02.05"],
      ["2025. 2. 1 오전 9:00:00", 111111]
    ]
  });
  assert.deepEqual(byCourseId?.get("246877"), {
    lastRequestedAt: "2025. 1. 9 오후 1:40:34", requestCount: 2, issueStatus: "발급완료", issuedAt: "2025. 1. 10", paidAt: "2025.02.05"
  });
  assert.equal(byCourseId?.get("111111")?.requestCount, 1);
  assert.equal(parseWebAppRows({ ok: false, error: "unauthorized" }), null);
  assert.equal(parseWebAppRows({ ok: true }), null);
  assert.equal(parseWebAppRows("<html>"), null);
});

const STATUS_ENV = ["INVOICE_REQUEST_SHEET_ID", "INVOICE_REQUEST_STATUS_URL", "INVOICE_REQUEST_STATUS_TOKEN"] as const;
const WEBAPP_URL = "https://script.google.com/macros/s/example/exec";

async function withStatusEnv(values: Partial<Record<(typeof STATUS_ENV)[number], string>>, run: () => Promise<void>) {
  const saved = Object.fromEntries(STATUS_ENV.map((key) => [key, process.env[key]]));
  const apply = (source: Partial<Record<string, string | undefined>>) => {
    for (const key of STATUS_ENV) {
      if (source[key] === undefined) delete process.env[key];
      else process.env[key] = source[key];
    }
  };
  apply(values);
  resetInvoiceRequestStatusCache();
  try {
    await run();
  } finally {
    resetInvoiceRequestStatusCache();
    apply(saved);
  }
}

test("시트 ID·웹앱 URL이 없으면 읽지 않고 not_configured로 알린다", async () => {
  await withStatusEnv({}, async () => {
    assert.deepEqual(await loadInvoiceRequestStatuses(), { ok: false, reason: "not_configured" });
  });
});

test("웹앱 URL만 있고 토큰이 없으면 호출하지 않고 not_configured", async () => {
  await withStatusEnv({ INVOICE_REQUEST_STATUS_URL: WEBAPP_URL }, async () => {
    assert.deepEqual(await loadInvoiceRequestStatuses(), { ok: false, reason: "not_configured" });
  });
});

test("웹앱 URL이 있으면 시트 대신 웹앱에서 읽고, 토큰은 URL이 아닌 본문으로 보낸다", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, rows: [["2025. 3. 1 오전 10:00:00", "246877", "발급완료", "2025. 3. 2", ""]] }));
  });
  await withStatusEnv(
    { INVOICE_REQUEST_SHEET_ID: "sheet", INVOICE_REQUEST_STATUS_URL: WEBAPP_URL, INVOICE_REQUEST_STATUS_TOKEN: "secret" },
    async () => {
      const result = await loadInvoiceRequestStatuses();
      assert.equal(result.ok && result.byCourseId.get("246877")?.issueStatus, "발급완료");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, WEBAPP_URL);
      assert.equal(calls[0].init?.method, "POST");
      assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { token: "secret" });
    }
  );
});

test("웹앱이 ok:false(토큰 불일치 등)를 주면 read_failed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ok: false, error: "unauthorized" })));
  await withStatusEnv({ INVOICE_REQUEST_STATUS_URL: WEBAPP_URL, INVOICE_REQUEST_STATUS_TOKEN: "wrong" }, async () => {
    assert.deepEqual(await loadInvoiceRequestStatuses(), { ok: false, reason: "read_failed" });
  });
});
