import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatchPreview } from "./instructorContractMatchPreview";
import type { InstructorContractRecord } from "./instructorContractSheet";
import type { InstructorNote } from "@/lib/data/instructorNoteRepository";

function op(courseId: string, instructors: string) {
  return { courseId, instructors };
}
function contract(partial: Partial<InstructorContractRecord>): InstructorContractRecord {
  return { courseId: "", instructorName: "", email: "", contractSent: false, contractCompleted: false, ...partial };
}
function ownerNote(name: string, notionNo: number): InstructorNote {
  return { instructorName: name, notionNo, notionId: `p${notionNo}`, notion: { syncedAt: "2026-01-01" } } as InstructorNote;
}

test("표기≠노션명이면 '진짜 새 연결'로 센다(디노랩스_김진태 → 김진태)", () => {
  const preview = buildMatchPreview(
    [op("238061", "디노랩스_김진태")],
    [contract({ courseId: "238061", instructorName: "김진태" })],
    [ownerNote("김진태", 12)],
    {}
  );
  assert.equal(preview.newLinks, 1);
  assert.equal(preview.sameNameMatched, 0);
  assert.deepEqual(preview.sampleNewLinks, [{ operationName: "디노랩스_김진태", notionName: "김진태", via: "name" }]);
});

test("표기==노션명이면 '이미 이름매칭'으로 세고 새 연결엔 안 넣는다(송선영 → 송선영)", () => {
  const preview = buildMatchPreview(
    [op("238061", "송선영")],
    [contract({ courseId: "238061", instructorName: "송선영" })],
    [ownerNote("송선영", 20)],
    {}
  );
  assert.equal(preview.newLinks, 0);
  assert.equal(preview.sameNameMatched, 1);
  assert.equal(preview.sampleNewLinks.length, 0);
});

test("이미 수동 연결된 표기는 alreadyLinked로 센다", () => {
  const preview = buildMatchPreview(
    [op("238061", "디노랩스_김진태")],
    [contract({ courseId: "238061", instructorName: "김진태" })],
    [ownerNote("김진태", 12)],
    { "디노랩스_김진태": "김진태" }
  );
  assert.equal(preview.alreadyLinked, 1);
  assert.equal(preview.newLinks, 0);
});

test("계약 근거 없는 강사는 어디에도 안 센다(토큰만 셈)", () => {
  const preview = buildMatchPreview(
    [op("999", "홍길동")],
    [contract({ courseId: "238061", instructorName: "김진태" })],
    [ownerNote("홍길동", 1)],
    {}
  );
  assert.equal(preview.operationTokens, 1);
  assert.equal(preview.newLinks, 0);
  assert.equal(preview.sameNameMatched, 0);
  assert.equal(preview.ambiguous, 0);
});

test("한 운영 건의 여러 강사를 각각 토큰으로 쪼갠다", () => {
  const preview = buildMatchPreview(
    [op("238061", "소속_김진태, 이영희")],
    [
      contract({ courseId: "238061", instructorName: "김진태" }),
      contract({ courseId: "238061", instructorName: "이영희" })
    ],
    [ownerNote("김진태", 12), ownerNote("이영희", 13)],
    {}
  );
  assert.equal(preview.operationTokens, 2);
  // 소속_김진태 → 김진태(표기≠노션명, 새 연결), 이영희 → 이영희(표기==노션명)
  assert.equal(preview.newLinks, 1);
  assert.equal(preview.sameNameMatched, 1);
});
