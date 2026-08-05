import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationCandidate } from "@/lib/data/coachImport/matchOperation";
import {
  matchSatisfactionRow,
  parseSatisfactionCsv,
  sheetValuesToRows,
  normalizeInstructorName,
  normalizeSheetDate,
  toEngagementKey,
  toSatisfactionSheetRow
} from "@/lib/data/satisfactionSheet.ts";

// eduops_log 시트의 실제 행(헤더 기준). 컬럼 순서 무관하게 헤더로 매핑된다.
const ROW_KT_OPENCLASS = {
  record_id: "96f0fe70-05e0-4",
  courseId: "260759",
  client: "KT",
  course: "KT AX Openclass",
  degree: "",
  date: "260724",
  audience: "대리급 실무",
  instructor: "김기호 강사",
  n: "14",
  target: "",
  overall: "4.36",
  pos_pct: "85.7"
};

const ROW_AX_OPERATION = {
  record_id: "782852f3-ea11-4",
  courseId: "260759",
  client: "KT",
  course: "2026년 AX 교육 운영",
  degree: "",
  date: "260619",
  audience: "대리급 실무",
  instructor: "김영욱 강사",
  n: "14",
  target: "",
  overall: "4.36",
  pos_pct: "85.7"
};

test("날짜 정규화: yymmdd → ISO", () => {
  assert.equal(normalizeSheetDate("260724"), "2026-07-24");
  assert.equal(normalizeSheetDate("260619"), "2026-06-19");
  assert.equal(normalizeSheetDate("2026-07-24"), "2026-07-24");
  assert.equal(normalizeSheetDate(""), "");
  assert.equal(normalizeSheetDate("260732"), ""); // 잘못된 날
});

test("강사명 정규화: 직함 제거", () => {
  assert.equal(normalizeInstructorName("김기호 강사"), "김기호");
  assert.equal(normalizeInstructorName("김영욱 강사"), "김영욱");
  assert.equal(normalizeInstructorName("홍길동"), "홍길동");
  assert.equal(normalizeInstructorName("이몽룡 교수 (외부)"), "이몽룡");
});

test("행 파싱: 표준 형태로 변환", () => {
  const row = toSatisfactionSheetRow(ROW_KT_OPENCLASS);
  assert.equal(row.courseId, "260759");
  assert.equal(row.course, "KT AX Openclass");
  assert.equal(row.date, "2026-07-24");
  assert.equal(row.instructor, "김기호");
  assert.equal(row.respondents, 14);
  assert.equal(row.overall, "4.36");
  assert.equal(row.posPct, 85.7);
});

test("EngagementKey 변환: 단일 강의일을 시작=종료로 매핑", () => {
  const key = toEngagementKey(toSatisfactionSheetRow(ROW_KT_OPENCLASS));
  assert.equal(key.courseName, "KT AX Openclass");
  assert.equal(key.coachName, "김기호");
  assert.equal(key.startDate, "2026-07-24");
  assert.equal(key.endDate, "2026-07-24");
  assert.deepEqual(key.scheduleDates, ["2026-07-24"]);
});

test("매칭: 과정명+일정이 정확히 맞는 운영 1건이면 matched", () => {
  const candidates: OperationCandidate[] = [
    {
      id: "op-openclass",
      courseName: "KT AX Openclass",
      companyName: "KT",
      startDate: "2026-07-24",
      endDate: "2026-07-24",
      instructorsText: "김기호"
    },
    {
      id: "op-other",
      courseName: "완전히 다른 과정",
      startDate: "2026-01-01",
      endDate: "2026-01-02"
    }
  ];
  const result = matchSatisfactionRow(toSatisfactionSheetRow(ROW_KT_OPENCLASS), candidates);
  assert.equal(result.status, "matched");
  assert.equal(result.operationId, "op-openclass");
});

test("매칭: 운영 기간이 여러 날이어도 강의일이 그 안이면 matched", () => {
  const candidates: OperationCandidate[] = [
    {
      id: "op-range",
      courseName: "KT AX Openclass",
      startDate: "2026-07-20",
      endDate: "2026-07-31",
      instructorsText: "김기호"
    }
  ];
  const result = matchSatisfactionRow(toSatisfactionSheetRow(ROW_KT_OPENCLASS), candidates);
  assert.equal(result.status, "matched");
  assert.equal(result.operationId, "op-range");
});

test("매칭: 같은 과정·일정 후보가 둘이면 ambiguous(오매칭 방지)", () => {
  const candidates: OperationCandidate[] = [
    { id: "op-a", courseName: "KT AX Openclass", startDate: "2026-07-24", endDate: "2026-07-24" },
    { id: "op-b", courseName: "KT AX Openclass", startDate: "2026-07-24", endDate: "2026-07-24" }
  ];
  const result = matchSatisfactionRow(toSatisfactionSheetRow(ROW_KT_OPENCLASS), candidates);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.operationId, null);
});

test("매칭: 맞는 후보가 없으면 unmatched", () => {
  const candidates: OperationCandidate[] = [
    { id: "op-x", courseName: "전혀 다른 교육", startDate: "2025-01-01", endDate: "2025-01-02" }
  ];
  const result = matchSatisfactionRow(toSatisfactionSheetRow(ROW_KT_OPENCLASS), candidates);
  assert.equal(result.status, "unmatched");
  assert.equal(result.operationId, null);
});

test("courseId 충돌 방지: 같은 courseId라도 과정명·강사·일정이 다르면 서로 다른 운영에 매칭", () => {
  // 두 행 모두 courseId=260759 지만 실제로는 다른 과정/일정/강사
  const candidates: OperationCandidate[] = [
    { id: "op-openclass", courseName: "KT AX Openclass", startDate: "2026-07-24", endDate: "2026-07-24", instructorsText: "김기호" },
    { id: "op-axops", courseName: "2026년 AX 교육 운영", startDate: "2026-06-19", endDate: "2026-06-19", instructorsText: "김영욱" }
  ];
  const a = matchSatisfactionRow(toSatisfactionSheetRow(ROW_KT_OPENCLASS), candidates);
  const b = matchSatisfactionRow(toSatisfactionSheetRow(ROW_AX_OPERATION), candidates);
  assert.equal(a.operationId, "op-openclass");
  assert.equal(b.operationId, "op-axops");
});

test("EngagementKey 변환: courseId도 전달한다", () => {
  const key = toEngagementKey(toSatisfactionSheetRow(ROW_KT_OPENCLASS));
  assert.equal(key.courseId, "260759");
});

test("매칭: 운영 등록명이 시트와 달라도 courseId가 같고 일정이 맞으면 matched", () => {
  const candidates: OperationCandidate[] = [
    {
      id: "op-openclass",
      courseId: "260759",
      courseName: "케이티 임직원 대상 특별 교육", // 시트 과정명과 표기가 전혀 다름
      companyName: "KT",
      startDate: "2026-07-24",
      endDate: "2026-07-24"
    }
  ];
  const result = matchSatisfactionRow(toSatisfactionSheetRow(ROW_KT_OPENCLASS), candidates);
  assert.equal(result.status, "matched");
  assert.equal(result.operationId, "op-openclass");
});

test("CSV 파싱: 헤더 매핑 + 따옴표 안 쉼표 처리", () => {
  const csv = [
    "record_id,courseId,client,course,degree,date,audience,instructor,n,target,overall,pos_pct",
    'r1,260759,KT,"KT AX Openclass, 심화",,260724,대리급 실무,김기호 강사,14,,4.36,85.7',
    "r2,260759,DD,신입과정,,260724,신입·신임,홍길동,22,,4.68,100"
  ].join("\n");
  const rows = parseSatisfactionCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].course, "KT AX Openclass, 심화");
  assert.equal(rows[0].instructor, "김기호");
  assert.equal(rows[0].date, "2026-07-24");
  assert.equal(rows[0].overall, "4.36");
  assert.equal(rows[1].instructor, "홍길동");
  assert.equal(rows[1].respondents, 22);
  assert.equal(rows[1].posPct, 100);
});

test("sheetValuesToRows: 헤더 행 번호 + 빈 행 제외", () => {
  const values = [
    ["record_id", "courseId", "course", "date", "instructor", "n", "overall", "pos_pct"],
    ["r1", "260759", "KT AX Openclass", "260724", "김기호 강사", "14", "4.36", "85.7"],
    ["", "", "", "", "", "", "", ""], // 빈 행
    ["r2", "260759", "신입과정", "260724", "홍길동", "22", "4.68", "100"]
  ];
  const rows = sheetValuesToRows(values, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].course, "KT AX Openclass");
  assert.equal(rows[0].instructor, "김기호");
  assert.equal(rows[1].instructor, "홍길동");
  assert.equal(rows[1].overall, "4.68");
});
