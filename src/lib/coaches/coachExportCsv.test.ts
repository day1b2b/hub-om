import assert from "node:assert/strict";
import { test } from "node:test";
import { toCoachExportCsv } from "./coachExportCsv";
test("coach export preserves BOM, columns, quoting, newline and blank export", () => {
  assert.equal(toCoachExportCsv([]), "\uFEFF");
  assert.equal(toCoachExportCsv([{ 이름: '가상,"코치"', 이메일: "coach@example.invalid" }, { 이름: "가상\n이름", 이메일: "" }]), '\uFEFF"이름","이메일"\n"가상,""코치""","coach@example.invalid"\n"가상\n이름",""');
});
test("formula and control-prefix cells are literal; international phones stay text", () => {
  for (const value of ["=1+1", "+123456", "-1+2", "@SUM(A1)", "  =SUM(1)", "\tplain", "\rplain", "\nplain", "\u00a0+123"]) {
    assert.ok(toCoachExportCsv([{ value }]).endsWith(`"'${value}"`));
  }
  assert.equal(toCoachExportCsv([{ value: "ordinary@example.invalid" }]), '\uFEFF"value"\n"ordinary@example.invalid"');
});
