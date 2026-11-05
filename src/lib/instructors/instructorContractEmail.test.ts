import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContractInstructorNoteId } from "./instructorContractEmail";
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
