import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blankTab,
  composeLectureNote,
  isDateUsedByOtherTab,
  mergePastedNote,
  mergeTabsWithSameDate,
  normalizeNoteDate,
  parseLectureNote,
  parseLectureNoteBody,
  prepareTabsForSave,
  shouldSplitPastedNote,
  suggestNextLectureDate
} from "@/features/operations/lectureNoteModel.ts";

test("내용도 날짜도 없는 빈 탭은 저장 대상에서 빠진다", () => {
  // "+ 날짜 추가"만 누르고 둔 탭이 시작일로 채워져 첫 탭과 같은 날짜로 저장되던 사례.
  const tabs = [{ ...blankTab("2026-09-01"), courseSummary: "1일차 요약" }, blankTab()];

  const prepared = prepareTabsForSave(tabs, "2026-09-01");

  assert.equal(prepared.length, 1);
  assert.equal(composeLectureNote(prepared), "[날짜: 2026-09-01]\n[강의 요약]\n1일차 요약");
});

test("내용은 있는데 날짜가 빈 탭만 시작일로 채운다", () => {
  const tabs = [{ ...blankTab(), courseSummary: "날짜 없는 옛 기록" }];

  assert.deepEqual(
    prepareTabsForSave(tabs, "2026-09-01").map((tab) => tab.date),
    ["2026-09-01"]
  );
});

test("날짜만 있고 내용이 없는 탭은 그대로 저장한다", () => {
  const tabs = [blankTab("2026-09-01"), blankTab("2026-09-02")];

  assert.deepEqual(
    prepareTabsForSave(tabs, "2026-09-01").map((tab) => tab.date),
    ["2026-09-01", "2026-09-02"]
  );
});

test("새 날짜 탭은 아직 쓰지 않은 교육일을 먼저 제안한다", () => {
  const educationDates = ["2026-09-01", "2026-09-02", "2026-09-03"];

  assert.equal(suggestNextLectureDate(["2026-09-01"], educationDates, "2026-09-01"), "2026-09-02");
  assert.equal(suggestNextLectureDate(["2026-09-01", "2026-09-02"], educationDates, "2026-09-01"), "2026-09-03");
});

test("교육일을 모두 썼거나 교육일 정보가 없으면 마지막 날짜 다음 날을 제안한다", () => {
  assert.equal(suggestNextLectureDate(["2026-09-01", "2026-09-03"], ["2026-09-01", "2026-09-03"], "2026-09-01"), "2026-09-04");
  assert.equal(suggestNextLectureDate(["2026-09-01"], [], "2026-09-01"), "2026-09-02");
  assert.equal(suggestNextLectureDate(["2026-09-30"], [], "2026-09-01"), "2026-10-01");
});

test("쓴 날짜가 하나도 없으면 시작일을 제안한다", () => {
  assert.equal(suggestNextLectureDate([], [], "2026-09-01"), "2026-09-01");
  assert.equal(suggestNextLectureDate([""], ["2026-09-01"], "2026-09-01"), "2026-09-01");
});

test("저장한 기록은 다시 열 때 같은 탭으로 돌아온다", () => {
  const tabs = [
    { ...blankTab("2026-09-01"), courseSummary: "1일차", studentCount: "27명" },
    { ...blankTab("2026-09-02"), issue: "프로젠터 지연" }
  ];

  assert.deepEqual(parseLectureNote(composeLectureNote(tabs), "2026-09-01"), tabs);
});

test("날짜가 빈 기록을 채울 때 이미 쓰인 날짜는 피한다", () => {
  // 옛 임시 보관본에는 날짜가 빈 탭이 남아 있을 수 있다. 시작일이 이미 쓰였으면 다음 교육일로 채운다.
  const tabs = [
    { ...blankTab("2026-09-01"), courseSummary: "1일차" },
    { ...blankTab(), courseSummary: "날짜를 못 고른 기록" }
  ];

  assert.deepEqual(
    prepareTabsForSave(tabs, "2026-09-01", ["2026-09-01", "2026-09-02"]).map((tab) => tab.date),
    ["2026-09-01", "2026-09-02"]
  );
});

test("날짜가 빈 기록이 여러 개면 서로 다른 날짜를 받는다", () => {
  const tabs = [
    { ...blankTab(), courseSummary: "a" },
    { ...blankTab(), courseSummary: "b" }
  ];

  assert.deepEqual(
    prepareTabsForSave(tabs, "2026-09-01", []).map((tab) => tab.date),
    ["2026-09-01", "2026-09-02"]
  );
});

test("다른 탭이 이미 쓰는 날짜인지 알려준다", () => {
  const tabs = [blankTab("2026-09-01"), blankTab("2026-09-02")];

  assert.equal(isDateUsedByOtherTab(tabs, 1, "2026-09-01"), true);
  assert.equal(isDateUsedByOtherTab(tabs, 1, "2026-09-02"), false);
  assert.equal(isDateUsedByOtherTab(tabs, 1, "2026-09-03"), false);
});

test("날짜가 여러 개 든 글을 붙여넣으면 날짜별 탭으로 나눈다", () => {
  const pasted = [
    "[날짜: 2026-09-01]",
    "학습 인원: 20명",
    "[강의 요약]",
    "1일차 오리엔테이션",
    "",
    "[날짜: 2026-09-02]",
    "[강의 요약]",
    "2일차 실습",
    "[이슈]",
    "프로젠터 지연"
  ].join("\n");
  const tabs = [blankTab("2026-09-01")];

  const merged = mergePastedNote(tabs, 0, pasted);

  assert.deepEqual(merged, [
    { ...blankTab("2026-09-01"), courseSummary: "1일차 오리엔테이션", studentCount: "20명" },
    { ...blankTab("2026-09-02"), courseSummary: "2일차 실습", issue: "프로젠터 지연" }
  ]);
});

test("붙여넣은 날짜가 이미 있는 탭이면 그 탭의 칸을 채우고, 비어 있지 않은 칸은 붙여넣은 값이 우선한다", () => {
  const tabs = [
    { ...blankTab("2026-09-01"), courseSummary: "기존 요약", issue: "기존 이슈" },
    blankTab("2026-09-02")
  ];
  const pasted = "[날짜: 2026-09-02]\n[강의 요약]\n2일차\n\n[날짜: 2026-09-01]\n[강의 요약]\n새 요약";

  const merged = mergePastedNote(tabs, 1, pasted);

  assert.deepEqual(merged, [
    { ...blankTab("2026-09-01"), courseSummary: "새 요약", issue: "기존 이슈" },
    { ...blankTab("2026-09-02"), courseSummary: "2일차" }
  ]);
});

test("날짜 제목 없이 칸 제목만 있는 글은 지금 보고 있는 탭에 채운다", () => {
  const tabs = [blankTab("2026-09-01"), { ...blankTab("2026-09-02"), staffOpinion: "기존 의견" }];

  const merged = mergePastedNote(tabs, 1, "[강의 요약]\n요약\n[이슈]\n이슈");

  assert.deepEqual(merged, [blankTab("2026-09-01"), { ...blankTab("2026-09-02"), courseSummary: "요약", issue: "이슈", staffOpinion: "기존 의견" }]);
});

test("날짜 제목 앞에 붙은 내용은 지금 보고 있는 탭에, 뒤는 해당 날짜 탭에 들어간다", () => {
  const tabs = [blankTab("2026-09-01")];

  const merged = mergePastedNote(tabs, 0, "[강의 요약]\n앞부분\n\n[날짜: 2026-09-03]\n[강의 요약]\n3일차");

  assert.deepEqual(merged, [{ ...blankTab("2026-09-01"), courseSummary: "앞부분" }, { ...blankTab("2026-09-03"), courseSummary: "3일차" }]);
});

test("붙여넣기 분리가 필요한 글인지 판단한다", () => {
  assert.equal(shouldSplitPastedNote("그냥 메모"), false);
  assert.equal(shouldSplitPastedNote("[강의 요약]\n요약"), true);
  assert.equal(shouldSplitPastedNote("[날짜: 2026-09-01]\n메모"), true);
});

test("칸 제목 앞에 적힌 글은 버리지 않고 강의 요약 앞에 붙인다", () => {
  // 날짜 표기 이전의 옛 기록은 "학습 인원: 20명" 줄 뒤에 자유 메모가 이어지기도 했다. 저장할 때 그 메모가 사라지면 안 된다.
  assert.deepEqual(parseLectureNoteBody("학습 인원: 20명\n오전은 이론, 오후는 실습"), {
    courseSummary: "오전은 이론, 오후는 실습",
    issue: "",
    staffOpinion: "",
    studentCount: "20명"
  });

  assert.deepEqual(parseLectureNoteBody("메모\n[강의 요약]\n요약"), {
    courseSummary: "메모\n\n요약",
    issue: "",
    staffOpinion: "",
    studentCount: ""
  });
});

test("칸 제목이 없는 글은 통째로 강의 요약이 된다", () => {
  assert.deepEqual(parseLectureNoteBody("  그냥 메모  "), { courseSummary: "그냥 메모", issue: "", staffOpinion: "", studentCount: "" });
  assert.deepEqual(parseLectureNoteBody(""), { courseSummary: "", issue: "", staffOpinion: "", studentCount: "" });
});

test("칸 제목이 뒤바뀐 글도 다른 칸의 글이 섞여 두 번 저장되지 않는다", () => {
  const parsed = parseLectureNoteBody("[이슈]\n프로젠터 지연\n[강의 요약]\n요약\n[운영진 의견]\n의견");

  assert.deepEqual(parsed, { courseSummary: "요약", issue: "프로젠터 지연", staffOpinion: "의견", studentCount: "" });
});

test("학습 인원 줄은 칸 제목 앞에서만 읽고 본문 안의 같은 표현은 요약에 그대로 둔다", () => {
  const parsed = parseLectureNoteBody("[강의 요약]\n학습 인원: 30명 참석, 오전 이론");

  assert.deepEqual(parsed, { courseSummary: "학습 인원: 30명 참석, 오전 이론", issue: "", staffOpinion: "", studentCount: "" });
});

test("저장 형식 그대로 다시 읽으면 칸 내용이 늘거나 줄지 않는다", () => {
  const tabs = [
    { ...blankTab("2026-09-01"), courseSummary: "1일차\n\n둘째 줄", issue: "이슈", staffOpinion: "의견", studentCount: "27명" }
  ];

  const roundTripped = parseLectureNote(composeLectureNote(tabs), "2026-09-01");
  assert.deepEqual(roundTripped, tabs);
  assert.equal(composeLectureNote(roundTripped), composeLectureNote(tabs));
});

test("날짜 제목의 표기가 달라도 같은 날로 읽어 탭이 두 개 생기지 않는다", () => {
  assert.equal(normalizeNoteDate("2026.9.1"), "2026-09-01");
  assert.equal(normalizeNoteDate("2026/09/01"), "2026-09-01");
  assert.equal(normalizeNoteDate("2026년 9월 1일"), "2026-09-01");
  assert.equal(normalizeNoteDate(" 2026-09-01 "), "2026-09-01");
  // 숫자 날짜가 아니면 적힌 대로 둔다.
  assert.equal(normalizeNoteDate("첫날"), "첫날");

  const merged = mergePastedNote([{ ...blankTab("2026-09-01"), issue: "기존 이슈" }], 0, "[날짜: 2026.9.1]\n[강의 요약]\n요약");
  assert.deepEqual(merged, [{ ...blankTab("2026-09-01"), courseSummary: "요약", issue: "기존 이슈" }]);
});

test("달력에 없는 날짜는 yyyy-mm-dd로 바꾸지 않고 적힌 대로 둔다", () => {
  assert.equal(normalizeNoteDate("2026-02-30"), "2026-02-30");
  assert.equal(normalizeNoteDate("2026.13.45"), "2026.13.45");
  assert.equal(normalizeNoteDate("2028-02-29"), "2028-02-29");
});

test("임시 보관본에 같은 날짜 탭이 둘 있으면 글을 잃지 않고 하나로 합친다", () => {
  const tabs = [
    { ...blankTab("2026-09-01"), courseSummary: "앞", studentCount: "20명" },
    blankTab("2026-09-02"),
    { ...blankTab("2026-09-01"), courseSummary: "뒤", issue: "이슈", studentCount: "21명" }
  ];

  assert.deepEqual(mergeTabsWithSameDate(tabs), [
    { ...blankTab("2026-09-01"), courseSummary: "앞\n\n뒤", issue: "이슈", studentCount: "20명 / 21명" },
    blankTab("2026-09-02")
  ]);
});

test("날짜 제목 뒤에 다른 글이 붙은 줄은 날짜 제목으로 읽지 않는다", () => {
  // 운영자가 강의 요약 칸에 "[날짜: 2026.9.1] + [강의 요약]"이라고 적었을 때 그 줄 전체가 날짜 탭 이름이 되던 사례.
  const typed = "[날짜: 2026.9.1] + [강의 요약]";

  assert.equal(shouldSplitPastedNote(typed), true);
  assert.deepEqual(mergePastedNote([blankTab("2026-09-01")], 0, typed), [
    { ...blankTab("2026-09-01"), courseSummary: "[날짜: 2026.9.1] +", issue: "", staffOpinion: "", studentCount: "" }
  ]);
  assert.deepEqual(parseLectureNote(typed, "2026-09-01"), [{ ...blankTab(""), courseSummary: "[날짜: 2026.9.1] +" }]);
});

test("같은 날짜의 서로 다른 학습 인원은 병합·저장·재복원 후에도 모두 남는다", () => {
  const a = { ...blankTab("2026-09-01"), studentCount: "20명" };
  const b = { ...blankTab("2026-09-01"), studentCount: "30명" };
  const merged = mergeTabsWithSameDate([a, b]);
  assert.equal(merged[0].studentCount, "20명 / 30명");
  const loaded = parseLectureNote(composeLectureNote(merged), "2026-09-01");
  assert.deepEqual(loaded, merged);
  assert.deepEqual(mergeTabsWithSameDate([...loaded, b, a]), merged);
});

test("학습 인원이 비었거나 같으면 불필요한 구분자를 추가하지 않는다", () => {
  const dated = blankTab("2026-09-01");
  assert.equal(mergeTabsWithSameDate([dated, { ...dated, studentCount: "20명" }, { ...dated, studentCount: "20명" }])[0].studentCount, "20명");
});

test("옛 보관본의 점·슬래시·한글 날짜는 정규화한 뒤 한 탭으로 복원한다", () => {
  const tabs = ["2026.9.1", "2026/09/01", "2026년 9월 1일", "2026-09-01"].map((date, index) => ({
    ...blankTab(date), courseSummary: `메모${index}`
  }));
  const merged = mergeTabsWithSameDate(tabs);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].date, "2026-09-01");
  assert.equal(merged[0].courseSummary, "메모0\n\n메모1\n\n메모2\n\n메모3");
  assert.deepEqual(parseLectureNote(composeLectureNote(merged), "2026-09-01"), merged);
  assert.deepEqual(mergeTabsWithSameDate(merged), merged);
  assert.equal(tabs[0].date, "2026.9.1");
});

test("날짜가 없는 기록끼리는 합치지 않고 잘못된 날짜 제목도 보존한다", () => {
  const tabs = [
    { ...blankTab(), courseSummary: "날짜 미상1" },
    { ...blankTab(), courseSummary: "날짜 미상2" },
    { ...blankTab("2026.2.30"), courseSummary: "잘못된 날짜" },
    { ...blankTab("첫날"), courseSummary: "자유 제목" }
  ];
  assert.deepEqual(mergeTabsWithSameDate(tabs), tabs);
});
