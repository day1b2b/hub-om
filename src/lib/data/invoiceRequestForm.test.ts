import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceRequestFormUrl } from "./invoiceRequestForm";

const COMPANY_NAME_ENTRY = "entry.1963784111";
const STUDENT_NAME_ENTRY = "entry.839876938";

function params(url: string): URLSearchParams {
  return new URLSearchParams(url.split("?")[1] ?? "");
}

test("법인명이 있으면 회사명엔 법인명, 수강생이름엔 기업명을 넣는다", () => {
  const q = params(buildInvoiceRequestFormUrl({ companyName: "샘플", legalName: "(주)샘플코리아" }));
  assert.equal(q.get(COMPANY_NAME_ENTRY), "(주)샘플코리아");
  assert.equal(q.get(STUDENT_NAME_ENTRY), "샘플");
});

test("법인명이 비어 있으면 회사명도 기업명으로 채운다", () => {
  for (const legalName of [null, undefined, "", "   "]) {
    const q = params(buildInvoiceRequestFormUrl({ companyName: "샘플", legalName }));
    assert.equal(q.get(COMPANY_NAME_ENTRY), "샘플");
    assert.equal(q.get(STUDENT_NAME_ENTRY), "샘플");
  }
});
