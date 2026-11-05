import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModusignDocument } from "@/lib/modusign/modusignClient";
import type { InstructorContractRecord } from "./instructorContractSheet";
import { courseNameScore, describeSigning, isSigningTracked, matchSigningDocuments, parseSheetTimestamp, summarizeSigning } from "./instructorContractSigning";
import { buildProgressEntries, diagnoseSigning, filterDocumentsByInstructorNames, progressKey } from "./instructorContractSigningSnapshot";

test("filterDocumentsByInstructorNames: 제목에 강사 이름(소속 접두사 뗀)이 든 문서만", () => {
  const docs = [
    { title: "1-2_담당_가상강사(소속)_(B2B) 고객_과정.docx" },
    { title: "3-4_담당_다른강사_(B2B) 고객_과정.docx" }
  ] as ModusignDocument[];
  assert.deepEqual(
    filterDocumentsByInstructorNames(docs, ["가상회사_가상강사"]).map((doc) => doc.title),
    ["1-2_담당_가상강사(소속)_(B2B) 고객_과정.docx"]
  );
  assert.deepEqual(filterDocumentsByInstructorNames(docs, ["없는사람"]), []);
});

function record(partial: Partial<InstructorContractRecord>): InstructorContractRecord {
  return { courseId: "", instructorName: "", email: "", contractSent: true, contractCompleted: true, ...partial };
}

/** 서명자 4명(OM→부서장→데이원→강사) 문서. signedCount명까지 서명함. */
function doc(partial: Partial<ModusignDocument> & { id: string; instructorEmail?: string; signedCount?: number }): ModusignDocument {
  const signedCount = partial.signedCount ?? 0;
  const participants = ["om@x", "lead@x", "contracts@x", partial.instructorEmail ?? "teacher@x"].map((email, index) => ({
    id: `${partial.id}-p${index + 1}`,
    type: "SIGNER",
    name: `p${index + 1}`,
    signingOrder: index + 1,
    signingMethod: { type: "EMAIL", value: email }
  }));
  return {
    title: "1 - 2_요청자_OM_강사(소속)_(B2B) 고객사_과정명.docx",
    status: signedCount >= 4 ? "COMPLETED" : "ON_GOING",
    createdAt: "2026-11-04T10:00:00+09:00",
    currentSigningOrder: signedCount + 1,
    participants,
    signings: participants.slice(0, signedCount).map((participant) => ({ participantId: participant.id, signedAt: "2026-11-04T11:00:00+09:00" })),
    ...partial
  };
}

test("parseSheetTimestamp: 오전·오후 KST", () => {
  assert.equal(parseSheetTimestamp("2026. 11. 3 오후 2:04:16"), Date.parse("2026-11-03T14:04:16+09:00"));
  assert.equal(parseSheetTimestamp("2026. 11. 3 오전 12:05:00"), Date.parse("2026-11-03T00:05:00+09:00"));
  assert.equal(parseSheetTimestamp("2026. 1. 9 오후 12:00:00"), Date.parse("2026-01-09T12:00:00+09:00"));
  assert.equal(parseSheetTimestamp(""), null);
  assert.equal(parseSheetTimestamp("어제"), null);
});

test("summarizeSigning: 누구 차례인지와 한 줄 문구", () => {
  const summary = summarizeSigning(doc({ id: "d1", signedCount: 2 }));
  assert.equal(summary.phase, "signing");
  assert.equal(summary.currentRole, "데이원");
  assert.deepEqual(summary.steps.map((step) => step.signed), [true, true, false, false]);
  assert.equal(describeSigning(summary), "OM·부서장 서명됨 → 데이원 서명 대기");

  assert.equal(describeSigning(summarizeSigning(doc({ id: "d0", signedCount: 0 }))), "OM 서명 대기");
  assert.equal(describeSigning(summarizeSigning(doc({ id: "d3", signedCount: 3 }))), "OM·부서장·데이원 서명됨 → 강사 서명 대기");
  assert.equal(describeSigning(summarizeSigning(doc({ id: "d4", signedCount: 4 }))), "서명 완료");
  assert.equal(summarizeSigning(doc({ id: "dx", status: "ABORTED" })).phase, "aborted");
});

test("matchSigningDocuments: 강사 이메일 + 요청 시각 이후 문서", () => {
  const inputs = [
    { key: "A", record: record({ courseId: "268718", instructorName: "최진영", email: "Teacher@X", requestedAt: "2026. 11. 3 오후 2:04:16" }) }
  ];
  const documents = [
    doc({ id: "old", createdAt: "2026-05-01T10:00:00+09:00", signedCount: 4 }), // 요청 반년 전 = 다른 계약
    doc({ id: "new", signedCount: 1 }),
    doc({ id: "other", instructorEmail: "someone@x", signedCount: 4 })
  ];
  const result = matchSigningDocuments(inputs, documents);
  assert.equal(result.get("A")?.phase, "signing");
  assert.equal(result.get("A")?.currentRole, "부서장");
});

test("matchSigningDocuments: 같은 강사 두 과정은 제목의 코스명으로 가른다", () => {
  const inputs = [
    { key: "A", record: record({ courseId: "1", instructorName: "김강사", email: "t@x", courseName: "(B2B) 두산_RAG 이해", requestedAt: "2026. 11. 3 오전 9:00:00" }) },
    { key: "B", record: record({ courseId: "2", instructorName: "김강사", email: "t@x", courseName: "(B2B) F&F_생성형 AI", requestedAt: "2026. 11. 3 오전 10:00:00" }) }
  ];
  const documents = [
    doc({ id: "dA", instructorEmail: "t@x", title: "9 - 1_요청자_OM_김강사(소속)_(B2B) 두산_RAG 이해.docx", signedCount: 4 }),
    doc({ id: "dB", instructorEmail: "t@x", title: "9 - 2_요청자_OM_김강사(소속)_(B2B) F&F_생성형 AI.docx", signedCount: 3 })
  ];
  const result = matchSigningDocuments(inputs, documents);
  assert.equal(result.get("A")?.phase, "completed");
  assert.equal(result.get("B")?.currentRole, "강사");
});

test("matchSigningDocuments: 가를 수 없으면 추측하지 않고 ambiguous", () => {
  const inputs = [
    { key: "A", record: record({ courseId: "1", instructorName: "김강사", email: "t@x", courseName: "과정 하나" }) },
    { key: "B", record: record({ courseId: "2", instructorName: "김강사", email: "t@x", courseName: "과정 둘" }) }
  ];
  const result = matchSigningDocuments(inputs, [doc({ id: "d", instructorEmail: "t@x", signedCount: 2 })]);
  assert.equal(result.get("A")?.phase, "ambiguous");
  assert.equal(result.get("B")?.phase, "ambiguous");
  assert.equal(result.get("A")?.ambiguousReason, "no-requested-at");
  assert.equal(describeSigning(result.get("A")!), "모두싸인 문서 확인 필요");
});

test("matchSigningDocuments: 취소 후 재발송이면 살아 있는 최신 문서", () => {
  const inputs = [{ key: "A", record: record({ courseId: "1", instructorName: "김강사", email: "t@x" }) }];
  const documents = [
    doc({ id: "aborted", instructorEmail: "t@x", status: "ABORTED", createdAt: "2026-11-05T10:00:00+09:00" }),
    doc({ id: "resent", instructorEmail: "t@x", signedCount: 1, createdAt: "2026-11-04T10:00:00+09:00" })
  ];
  assert.equal(matchSigningDocuments(inputs, documents).get("A")?.phase, "signing");
});

test("matchSigningDocuments: 이메일이 없으면 제목의 강사명으로", () => {
  const inputs = [{ key: "A", record: record({ courseId: "1", instructorName: "디노랩스_김진태", email: "" }) }];
  const documents = [doc({ id: "d", title: "1 - 2_요청자_OM_김진태(디노랩스)_(B2B) 고객_과정.docx", signedCount: 4 })];
  assert.equal(matchSigningDocuments(inputs, documents).get("A")?.phase, "completed");
});

test("buildProgressEntries: 발송 안 된 행은 모두싸인과 맞추지 않고, 결과에 이메일이 없다", () => {
  const records = [
    record({ courseId: "238061.0", instructorName: "김강사", email: "t@x", contractSent: true }),
    record({ courseId: "238062", instructorName: "이강사", email: "u@x", contractSent: false })
  ];
  const entries = buildProgressEntries(records, [doc({ id: "d", instructorEmail: "t@x", signedCount: 4 })]);
  assert.equal(entries[progressKey("238061", "김강사")]?.signing?.phase, "completed");
  assert.deepEqual(entries[progressKey("238062", "이강사")], { requested: true, sent: false });
  assert.ok(!JSON.stringify(entries).includes("t@x"));

  const sheetOnly = buildProgressEntries(records, null);
  assert.equal(sheetOnly[progressKey("238061", "김강사")]?.signing, undefined);
  assert.equal(sheetOnly[progressKey("238061", "김강사")]?.sent, true);
});

test("matchSigningDocuments: 같은 과정명 차수는 요청 시각 순서로 문서를 나눈다", () => {
  const same = { instructorName: "김강사", email: "t@x", courseName: "(B2B) KT_AI 기초" };
  const inputs = [
    { key: "1차", record: record({ ...same, courseId: "1", requestedAt: "2026. 9. 1 오전 9:00:00" }) },
    { key: "2차", record: record({ ...same, courseId: "2", requestedAt: "2026. 10. 1 오전 9:00:00" }) }
  ];
  const documents = [
    doc({ id: "d1", instructorEmail: "t@x", createdAt: "2026-09-02T10:00:00+09:00", signedCount: 4 }),
    doc({ id: "d2", instructorEmail: "t@x", createdAt: "2026-10-02T10:00:00+09:00", signedCount: 1 })
  ];
  const result = matchSigningDocuments(inputs, documents);
  assert.equal(result.get("1차")?.phase, "completed");
  assert.equal(result.get("2차")?.currentRole, "부서장");
});

test("matchSigningDocuments: 하루 안에 연달아 요청된 같은 과정명은 순서로 못 가른다", () => {
  const same = { instructorName: "김강사", email: "t@x", courseName: "(B2B) KT_AI 기초" };
  const inputs = [
    { key: "A", record: record({ ...same, courseId: "1", requestedAt: "2026. 11. 3 오전 9:00:00" }) },
    { key: "B", record: record({ ...same, courseId: "2", requestedAt: "2026. 11. 3 오전 9:05:00" }) }
  ];
  const documents = [
    doc({ id: "d1", instructorEmail: "t@x", signedCount: 4 }),
    doc({ id: "d2", instructorEmail: "t@x", signedCount: 1 })
  ];
  const result = matchSigningDocuments(inputs, documents);
  assert.equal(result.get("A")?.ambiguousReason, "same-time-requests");
  assert.equal(result.get("B")?.ambiguousReason, "same-time-requests");
});

test("matchSigningDocuments: 시간순 배정이 한쪽으로 쏠리면 추측하지 않는다", () => {
  const same = { instructorName: "김강사", email: "t@x", courseName: "(B2B) KT_AI 기초" };
  const inputs = [
    { key: "A", record: record({ ...same, courseId: "1", requestedAt: "2026. 11. 1 오전 9:00:00" }) },
    { key: "B", record: record({ ...same, courseId: "2", requestedAt: "2026. 11. 3 오전 9:00:00" }) }
  ];
  // 두 요청 뒤에 계약서 두 장을 연달아 만든 경우: 둘 다 "직전 요청" B로 가고 A는 0장.
  const documents = [
    doc({ id: "d1", instructorEmail: "t@x", createdAt: "2026-11-04T10:00:00+09:00", signedCount: 4 }),
    doc({ id: "d2", instructorEmail: "t@x", createdAt: "2026-11-04T11:00:00+09:00", signedCount: 1 })
  ];
  const result = matchSigningDocuments(inputs, documents);
  assert.equal(result.get("A")?.ambiguousReason, "uneven-split");
  assert.equal(result.get("B")?.ambiguousReason, "uneven-split");
});

test("courseNameScore: 표기가 조금 달라도 같은 과정은 높고, 같은 고객사 다른 과정은 낮다", () => {
  const title = "9 - 1_요청자_OM_김강사(소속)_(B2B) 두산_RAG 이해와 실습.docx";
  assert.equal(courseNameScore("(B2B) 두산_RAG 이해와 실습", title), 1);
  assert.ok(courseNameScore("(B2B) 두산_RAG 이해 및 실습", title) >= 0.7);
  assert.ok(courseNameScore("(B2B) 두산_생성형 AI 기초", title) < 0.7);
});

test("diagnoseSigning: 이유별 건수(이름·이메일 없음)", () => {
  const records = [
    record({ courseId: "1", instructorName: "김강사", email: "t@x", courseName: "과정 하나" }),
    record({ courseId: "2", instructorName: "김강사", email: "t@x", courseName: "과정 둘" }),
    record({ courseId: "3", instructorName: "이강사", email: "u@x", requestedAt: "2026. 11. 3 오전 9:00:00" })
  ];
  const documents = [doc({ id: "d", instructorEmail: "t@x", signedCount: 2 })];
  const entries = buildProgressEntries(records, documents);
  const diagnostics = diagnoseSigning(records, documents, entries);
  assert.deepEqual(diagnostics, {
    documentCount: 1,
    sentRows: 3,
    sentMissingCourseName: 1,
    sentMissingRequestedAt: 2,
    notFound: 1,
    ambiguousByReason: { "no-requested-at": 2, "same-time-requests": 0, "uneven-split": 0 }
  });
  assert.ok(!JSON.stringify(diagnostics).includes("t@x"));
});

test("isSigningTracked: 교육 시작일 2026-09-01부터", () => {
  assert.equal(isSigningTracked("2026-09-01"), true);
  assert.equal(isSigningTracked("2027-06-04"), true);
  assert.equal(isSigningTracked("2026-08-31"), false);
  assert.equal(isSigningTracked(undefined), false);
});
