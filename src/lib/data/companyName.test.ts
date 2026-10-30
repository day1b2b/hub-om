import assert from "node:assert/strict";
import test from "node:test";
import { companyNameError } from "./companyName";

test("기업명은 비어 있거나 띄어쓰기가 있으면 거절한다", () => {
  assert.equal(companyNameError("도레이첨단소재주식회사"), null);
  assert.equal(companyNameError("  (주)불스원  "), null, "앞뒤 공백은 저장 시 정리되므로 허용");
  assert.match(companyNameError("도레이첨단소재 주식회사") ?? "", /띄어쓰기/);
  assert.match(companyNameError("데이원\t컴퍼니") ?? "", /띄어쓰기/);
  assert.match(companyNameError("   ") ?? "", /입력/);
  assert.match(companyNameError(undefined) ?? "", /입력/);
});
