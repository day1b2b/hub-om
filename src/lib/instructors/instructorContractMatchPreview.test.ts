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

test("계약시트 코스ID 다리로 운영현황 자유텍스트가 노션에 자동 연결된다", () => {
  const preview = buildMatchPreview(
    [op("238061", "디노랩스_김진태")],
    [contract({ courseId: "238061", instructorName: "김진태" })],
    [ownerNote("김진태", 12)],
    {}
  );
  assert.equal(preview.autoLinkable, 1);
  assert.equal(preview.alreadyLinked, 0);
  assert.deepEqual(preview.sampleAutoLinks, [{ operationName: "디노랩스_김진태", notionName: "김진태", via: "name" }]);
});

test("이미 연결된 표기는 autoLinkable이 아니라 alreadyLinked로 센다", () => {
  const preview = buildMatchPreview(
    [op("238061", "디노랩스_김진태")],
    [contract({ courseId: "238061", instructorName: "김진태" })],
    [ownerNote("김진태", 12)],
    { "디노랩스_김진태": "김진태" }
  );
  assert.equal(preview.alreadyLinked, 1);
  assert.equal(preview.autoLinkable, 0);
});

test("계약 근거 없는 강사는 링크 0(토큰은 셈)", () => {
  const preview = buildMatchPreview(
    [op("999", "홍길동")],
    [contract({ courseId: "238061", instructorName: "김진태" })],
    [ownerNote("홍길동", 1)],
    {}
  );
  assert.equal(preview.operationTokens, 1);
  assert.equal(preview.autoLinkable, 0);
  assert.equal(preview.ambiguous, 0);
});

test("한 운영 건의 여러 강사를 각각 토큰으로 쪼갠다", () => {
  const preview = buildMatchPreview(
    [op("238061", "김진태, 이영희")],
    [
      contract({ courseId: "238061", instructorName: "김진태" }),
      contract({ courseId: "238061", instructorName: "이영희" })
    ],
    [ownerNote("김진태", 12), ownerNote("이영희", 13)],
    {}
  );
  assert.equal(preview.operationTokens, 2);
  assert.equal(preview.autoLinkable, 2);
});
