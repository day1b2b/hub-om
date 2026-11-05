import { test } from "node:test";
import assert from "node:assert/strict";
import { findLastContractFee, notionBaseFee, parseHourlyFee, resolveContractInstructorNoteId } from "./instructorContractEmail";
import type { InstructorContractRecord } from "./instructorContractSheet";

function contract(partial: Partial<InstructorContractRecord>): InstructorContractRecord {
  return { courseId: "", instructorName: "", email: "", contractSent: false, contractCompleted: false, ...partial };
}

test("parseHourlyFee: 자유 입력 강사료를 원으로", () => {
  assert.equal(parseHourlyFee("250,000"), 250000);
  assert.equal(parseHourlyFee("25만원"), 250000);
  assert.equal(parseHourlyFee("12.5만"), 125000);
  assert.equal(parseHourlyFee("250,000(부가세 별도)"), 250000);
  assert.equal(parseHourlyFee(""), null);
  assert.equal(parseHourlyFee("협의"), null);
  assert.equal(parseHourlyFee("0"), null);
});

test("findLastContractFee: 가장 최근 계약, 동명이인(이메일 2개 이상)은 비움", () => {
  const records = [
    contract({ instructorName: "가상강사", email: "a@example.invalid", hourlyFee: "200,000", requestedAt: "2026. 3. 2 오후 2:04:16" }),
    contract({ instructorName: "가상회사_가상강사", email: "a@example.invalid", hourlyFee: "250,000", requestedAt: "2026. 10. 20 오전 9:00:00" }),
    contract({ instructorName: "가상강사", email: "a@example.invalid", hourlyFee: "협의", requestedAt: "2026. 11. 1 오전 9:00:00" })
  ];
  assert.deepEqual(findLastContractFee(records, "가상강사"), { amount: 250000, month: "2026.10" });
  assert.equal(findLastContractFee(records, "없는사람"), undefined);
  const homonym = [...records, contract({ instructorName: "가상강사", email: "b@example.invalid", hourlyFee: "100,000", requestedAt: "2026. 9. 1 오전 9:00:00" })];
  assert.equal(findLastContractFee(homonym, "가상강사"), undefined);
});

test("notionBaseFee: 1,000원 미만 비정상값은 버림", () => {
  assert.equal(notionBaseFee({ notion: { baseFee: 220000 } }), 220000);
  assert.equal(notionBaseFee({ notion: { baseFee: 2.25 } }), undefined);
  assert.equal(notionBaseFee(undefined), undefined);
});
import type { InstructorNote } from "@/lib/data/instructorNoteRepository";

const notes: InstructorNote[] = [
  { id: "n1", notionNo: 1, instructorName: "가상강사" },
  { id: "n2", notionNo: 2, instructorName: "동명이인" },
  { id: "n3", notionNo: 3, instructorName: "동명이인" },
  { id: "n4", notionNo: 4, instructorName: "연결대상" },
  { id: "op1", instructorName: "운영표기만" }
];

test("resolveContractInstructorNoteId: 노션 강사 1명으로 확정될 때만 id", () => {
  assert.equal(resolveContractInstructorNoteId(notes, {}, "가상강사"), "n1");
  assert.equal(resolveContractInstructorNoteId(notes, {}, " 가상강사 "), "n1");
  // 동명이인은 추측하지 않는다.
  assert.equal(resolveContractInstructorNoteId(notes, {}, "동명이인"), null);
  // 노션 NO 없는 운영 표기 노트·없는 이름은 못 찾음.
  assert.equal(resolveContractInstructorNoteId(notes, {}, "운영표기만"), null);
  assert.equal(resolveContractInstructorNoteId(notes, {}, "없는사람"), null);
  assert.equal(resolveContractInstructorNoteId(notes, {}, ""), null);
});

test("resolveContractInstructorNoteId: 위키 수동 연결을 따른다", () => {
  assert.equal(resolveContractInstructorNoteId(notes, { "가상회사_별칭": "연결대상" }, "가상회사_별칭"), "n4");
});
