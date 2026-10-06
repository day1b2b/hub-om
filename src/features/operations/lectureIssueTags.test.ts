import assert from "node:assert/strict";
import { test } from "node:test";
import { blankTab, composeLectureNote, extractIssueTagsFromNote, mergePastedNote, mergeTabsWithSameDate, normalizeIssueTags, parseLectureNote } from "./lectureNoteModel";
import { readDraft, writeDraft } from "./lectureNoteDraftStorage";

test("날짜 앞 메모·인원·섹션 순서·미등록 태그를 저장 왕복에서 보존한다", () => {
  const input = "공통 메모\n[날짜: 2026.9.1]\n학습 인원: 20명\n[이슈 유형]\n장비, 사내유형\n[운영진 의견]\n의견\n[강의 요약]\n요약\n[이슈]\n대응";
  const parsed = parseLectureNote(input, "");
  assert.deepEqual(parseLectureNote(composeLectureNote(parsed), ""), parsed);
  assert.equal(parsed[0].courseSummary, "공통 메모");
  assert.equal(parsed[1].studentCount, "20명");
  assert.deepEqual(parsed[1].issueTags, ["장비", "사내유형"]);
});

test("태그만 있는 기록도 저장되고 회차별로 중복을 제거한다", () => {
  const tabs = ["2026-09-01", "2026-09-02"].map((date) => ({ ...blankTab(date), issueTags: ["장비", "장비", "자료"] }));
  const saved = composeLectureNote(tabs);
  assert.deepEqual(extractIssueTagsFromNote(saved), ["장비", "자료"]);
  assert.equal(parseLectureNote(saved, "").length, 2);
});

test("같은 날짜 병합은 태그 합집합과 서로 다른 인원을 보존한다", () => {
  const merged = mergeTabsWithSameDate([
    { ...blankTab("2026.9.1"), issueTags: ["장비"], studentCount: "20명" },
    { ...blankTab("2026-09-01"), issueTags: ["장비", "자료"], studentCount: "30명" }
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].issueTags, ["장비", "자료"]);
  assert.equal(merged[0].studentCount, "20명 / 30명");
});

test("태그 없는 붙여넣기는 기존 태그를 지우지 않고 다른 탭을 바꾸지 않는다", () => {
  const original = [{ ...blankTab("2026-09-01"), issueTags: ["장비"] }, blankTab("2026-09-02")];
  const merged = mergePastedNote(original, 0, "[강의 요약]\n새 요약");
  assert.deepEqual(merged[0].issueTags, ["장비"]);
  assert.deepEqual(merged[1], original[1]);
  assert.equal(original[0].courseSummary, "");
});

test("구버전 초안과 태그 포함 초안을 모두 복원한다", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  for (const tabs of [[blankTab()], [{ ...blankTab(), issueTags: ["자료"] }]]) {
    assert.equal(writeDraft("TEST", { tabs, linkDraft: "", mode: "text", updatedAt: "2020-01-01" }, storage), true);
    assert.deepEqual(normalizeIssueTags(readDraft("TEST", storage)?.tabs[0].issueTags), normalizeIssueTags(tabs[0].issueTags));
  }
  assert.deepEqual(normalizeIssueTags(null), []);
  assert.deepEqual(normalizeIssueTags([" 자료 ", 12, "자료"]), ["자료"]);
});
