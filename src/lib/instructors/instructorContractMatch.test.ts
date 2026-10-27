import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchInstructorLinks,
  normalizeInstructorName,
  type NotionInstructorRef,
  type OperationInstructor
} from "./instructorContractMatch";
import type { InstructorContractRecord } from "./instructorContractSheet";

function contract(partial: Partial<InstructorContractRecord>): InstructorContractRecord {
  return { courseId: "", instructorName: "", email: "", contractSent: false, contractCompleted: false, ...partial };
}

test("normalizeInstructorName strips 소속 접두사와 공백", () => {
  assert.equal(normalizeInstructorName("디노랩스_김진태"), "김진태");
  assert.equal(normalizeInstructorName(" 김 진 태 "), "김진태");
  assert.equal(normalizeInstructorName("김진태"), "김진태");
});

test("이메일이 맞으면 코스ID를 다리로 노션에 연결한다(via=email)", () => {
  const operations: OperationInstructor[] = [{ courseId: "238061", name: "디노랩스_김진태" }];
  const contracts = [contract({ courseId: "238061", instructorName: "김진태", email: "Jin@Example.com" })];
  const notion: NotionInstructorRef[] = [{ notionNo: 12, name: "김진태", emails: ["jin@example.com"] }];

  const result = matchInstructorLinks(operations, contracts, notion);
  assert.deepEqual(result.links, [{ operationName: "디노랩스_김진태", notionNo: 12, via: "email" }]);
  assert.equal(result.ambiguous.length, 0);
});

test("이메일이 없으면 노션에 동명이 유일할 때 이름으로 연결한다(via=name)", () => {
  const operations: OperationInstructor[] = [{ courseId: "239412", name: "이동훈" }];
  const contracts = [contract({ courseId: "239412", instructorName: "이동훈", email: "" })];
  const notion: NotionInstructorRef[] = [{ notionNo: 7, name: "이동훈", emails: [] }];

  const result = matchInstructorLinks(operations, contracts, notion);
  assert.deepEqual(result.links, [{ operationName: "이동훈", notionNo: 7, via: "name" }]);
});

test("노션에 동명이인이고 이메일로 못 붙으면 ambiguous로 남긴다", () => {
  const operations: OperationInstructor[] = [{ courseId: "300", name: "김준범" }];
  const contracts = [contract({ courseId: "300", instructorName: "김준범", email: "" })];
  const notion: NotionInstructorRef[] = [
    { notionNo: 185, name: "김준범", emails: [] },
    { notionNo: 746, name: "김준범", emails: [] }
  ];

  const result = matchInstructorLinks(operations, contracts, notion);
  assert.equal(result.links.length, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].operationName, "김준범");
});

test("동명이인이라도 이메일이 맞으면 정확히 연결한다", () => {
  const operations: OperationInstructor[] = [{ courseId: "300", name: "김준범" }];
  const contracts = [contract({ courseId: "300", instructorName: "김준범", email: "b@example.com" })];
  const notion: NotionInstructorRef[] = [
    { notionNo: 185, name: "김준범", emails: ["a@example.com"] },
    { notionNo: 746, name: "김준범", emails: ["b@example.com"] }
  ];

  const result = matchInstructorLinks(operations, contracts, notion);
  assert.deepEqual(result.links, [{ operationName: "김준범", notionNo: 746, via: "email" }]);
  assert.equal(result.ambiguous.length, 0);
});

test("그 코스에 계약 근거가 없으면 조용히 건너뛴다(링크·모호 둘 다 아님)", () => {
  const operations: OperationInstructor[] = [{ courseId: "999", name: "홍길동" }];
  const contracts = [contract({ courseId: "238061", instructorName: "김진태", email: "jin@example.com" })];
  const notion: NotionInstructorRef[] = [{ notionNo: 1, name: "홍길동", emails: [] }];

  const result = matchInstructorLinks(operations, contracts, notion);
  assert.equal(result.links.length, 0);
  assert.equal(result.ambiguous.length, 0);
});

test("같은 표기는 한 번만 연결한다(중복 방지)", () => {
  const operations: OperationInstructor[] = [
    { courseId: "238061", name: "김진태" },
    { courseId: "238061", name: "김진태" }
  ];
  const contracts = [contract({ courseId: "238061", instructorName: "김진태", email: "jin@example.com" })];
  const notion: NotionInstructorRef[] = [{ notionNo: 12, name: "김진태", emails: ["jin@example.com"] }];

  const result = matchInstructorLinks(operations, contracts, notion);
  assert.equal(result.links.length, 1);
});
