import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blankTab,
  composeLectureNote,
  isDateUsedByOtherTab,
  mergePastedNote,
  parseLectureNote,
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
