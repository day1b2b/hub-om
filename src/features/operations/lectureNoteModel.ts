export interface LectureNoteDraft {
  courseSummary: string;
  issue: string;
  staffOpinion: string;
  studentCount: string;
}

export interface LectureNoteTab extends LectureNoteDraft {
  date: string;
}

const COURSE_SUMMARY_MARKER = "[강의 요약]";
const STAFF_OPINION_MARKER = "[운영진 의견]";
const ISSUE_MARKER = "[이슈]";
const DATE_HEADER_PATTERN = /^\[날짜:\s*(.*?)\]\s*$/gm;

export function blankTab(defaultDate: string = ""): LectureNoteTab {
  return { courseSummary: "", date: defaultDate, issue: "", staffOpinion: "", studentCount: "" };
}

export function containsNoteMarkers(value: string): boolean {
  return value.includes(COURSE_SUMMARY_MARKER) || value.includes(STAFF_OPINION_MARKER) || value.includes(ISSUE_MARKER);
}

export function parseLectureNote(value: string, defaultDate: string): LectureNoteTab[] {
  const blocks = splitDateBlocks(value);
  const tabs = blocks.map((block) => ({ date: block.date, ...parseLectureNoteBody(block.body) }));

  if (tabs.length === 0) return [blankTab(defaultDate)];
  if (tabs.length === 1 && !tabs[0].date.trim() && !hasTabContent(tabs[0])) return [blankTab(defaultDate)];

  return tabs;
}

function splitDateBlocks(value: string): { date: string; body: string }[] {
  const matches = [...value.matchAll(DATE_HEADER_PATTERN)];

  if (matches.length === 0) return [{ body: value, date: "" }];

  const blocks = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? value.length : value.length;

    return { body: value.slice(start, end).trim(), date: normalizeNoteDate(match[1]) };
  });

  // 첫 날짜 제목 앞에 적힌 내용은 버리지 않고 날짜 없는 블록으로 남긴다.
  const leading = value.slice(0, matches[0].index ?? 0).trim();
  return leading ? [{ body: leading, date: "" }, ...blocks] : blocks;
}

const STUDENT_COUNT_LINE_PATTERN = /^[^\S\n]*학습\s*인원\s*[:：][^\S\n]*(.*)$/m;

/**
 * 한 날짜 블록의 본문을 네 칸으로 나눈다. 칸 제목 앞에 적힌 글(옛 자유 메모, 학습 인원 줄 뒤의 메모)은
 * 버리지 않고 강의 요약 앞에 붙인다. 버리면 저장할 때 그 글이 사라진다.
 */
export function parseLectureNoteBody(value: string): LectureNoteDraft {
  const firstMarkerIndex = [COURSE_SUMMARY_MARKER, STAFF_OPINION_MARKER, ISSUE_MARKER]
    .map((marker) => value.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0];
  const preamble = firstMarkerIndex === undefined ? value : value.slice(0, firstMarkerIndex);

  const studentCountMatch = preamble.match(STUDENT_COUNT_LINE_PATTERN);
  const studentCount = studentCountMatch ? studentCountMatch[1].trim() : "";
  const leadingText = (studentCountMatch ? preamble.replace(studentCountMatch[0], "") : preamble).trim();

  const summarySection = extractSection(value, COURSE_SUMMARY_MARKER);
  const courseSummary = [leadingText, summarySection].filter(Boolean).join("\n\n");
  const staffOpinion = extractSection(value, STAFF_OPINION_MARKER);
  const issue = extractSection(value, ISSUE_MARKER);

  return { courseSummary, issue, staffOpinion, studentCount };
}

/** 칸 제목 뒤부터 다음 칸 제목 앞까지. 칸 순서가 뒤바뀐 글이라도 다른 칸의 글이 섞여 들어오지 않게 모든 제목에서 끊는다. */
function extractSection(value: string, marker: string): string {
  const startIndex = value.indexOf(marker);
  if (startIndex === -1) return "";

  const afterMarker = value.slice(startIndex + marker.length);
  const endIndex = [COURSE_SUMMARY_MARKER, STAFF_OPINION_MARKER, ISSUE_MARKER]
    .filter((other) => other !== marker)
    .map((other) => afterMarker.indexOf(other))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0];

  return (endIndex === undefined ? afterMarker : afterMarker.slice(0, endIndex)).trim();
}

export function composeLectureNote(tabs: LectureNoteTab[]): string {
  const meaningfulTabs = tabs.filter((tab) => hasTabContent(tab));

  if (meaningfulTabs.length === 0) return "";

  if (meaningfulTabs.length === 1 && !meaningfulTabs[0].date.trim()) {
    return composeLectureNoteBody(meaningfulTabs[0]);
  }

  return meaningfulTabs
    .map((tab) => `[날짜: ${tab.date.trim()}]\n${composeLectureNoteBody(tab)}`.trim())
    .join("\n\n");
}

export function hasTabContent(tab: LectureNoteTab): boolean {
  return Boolean(tab.date.trim()) || hasBodyContent(tab);
}

function composeLectureNoteBody(draft: LectureNoteDraft): string {
  const sections = [
    draft.studentCount.trim() ? `학습 인원: ${draft.studentCount.trim()}` : "",
    draft.courseSummary.trim() ? `${COURSE_SUMMARY_MARKER}\n${draft.courseSummary.trim()}` : "",
    draft.staffOpinion.trim() ? `${STAFF_OPINION_MARKER}\n${draft.staffOpinion.trim()}` : "",
    draft.issue.trim() ? `${ISSUE_MARKER}\n${draft.issue.trim()}` : ""
  ].filter(Boolean);

  return sections.join("\n\n");
}

/** 날짜를 뺀 네 칸 중 하나라도 적혀 있는지. 날짜만 있는 탭은 hasTabContent로 따로 본다. */
function hasBodyContent(tab: LectureNoteDraft): boolean {
  return Boolean(tab.courseSummary.trim() || tab.staffOpinion.trim() || tab.issue.trim() || tab.studentCount.trim());
}

/**
 * 저장 직전 탭 정리. 내용도 날짜도 없는 빈 탭은 버리고, 내용은 있는데 날짜가 빈 탭(날짜 표기 이전의 옛 기록,
 * 옛 임시 보관본)은 아직 다른 탭이 쓰지 않는 날짜로 채운다. 시작일이 비어 있으면 시작일, 아니면 다음 교육일.
 * 빈 탭까지 시작일로 채우면 첫 탭과 같은 날짜가 두 번 저장된다.
 */
export function prepareTabsForSave(tabs: LectureNoteTab[], startDate: string, educationDates: string[] = []): LectureNoteTab[] {
  const kept = tabs.filter((tab) => tab.date.trim() || hasBodyContent(tab));
  const usedDates = kept.map((tab) => tab.date.trim()).filter(Boolean);

  return kept.map((tab) => {
    const date = tab.date.trim();
    if (date) return { ...tab, date };

    const freeDate = usedDates.includes(startDate) ? suggestNextLectureDate(usedDates, educationDates, startDate) : startDate;
    usedDates.push(freeDate);
    return { ...tab, date: freeDate };
  });
}

/** 같은 날짜 탭이 두 개 생기지 않도록, 고른 날짜를 다른 탭이 이미 쓰는지 확인한다. */
export function isDateUsedByOtherTab(tabs: LectureNoteTab[], tabIndex: number, date: string): boolean {
  const target = date.trim();
  if (!target) return false;

  return tabs.some((tab, index) => index !== tabIndex && tab.date.trim() === target);
}

/**
 * 새 날짜 탭에 넣을 날짜. 아직 탭이 없는 교육일이 있으면 그중 가장 빠른 날, 없으면 마지막 날짜의 다음 날.
 * 빈 날짜로 두면 저장 시 시작일로 채워져 다른 탭과 겹치므로 처음부터 겹치지 않는 날짜를 준다.
 */
export function suggestNextLectureDate(usedDates: string[], educationDates: string[], startDate: string): string {
  const used = new Set(usedDates.map((date) => date.trim()).filter(Boolean));

  if (used.size === 0) return startDate;

  const unusedEducationDate = [...educationDates].sort().find((date) => !used.has(date));
  if (unusedEducationDate) return unusedEducationDate;

  const latest = [...used].sort().at(-1) ?? startDate;
  return addDays(latest, 1);
}

/**
 * 날짜 제목의 표기를 yyyy-mm-dd로 맞춘다. 붙여넣은 글의 "2026.9.1", "2026/09/01"이 탭의 "2026-09-01"과
 * 다른 글자로 남으면 같은 날 탭이 두 개 생긴다. 숫자 날짜가 아니면 적힌 대로 둔다.
 */
export function normalizeNoteDate(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\s*[.]?$/);
  if (!match) return trimmed;

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;

  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

/** 붙여넣은 글에 칸 제목이나 날짜 제목이 있어 칸/탭으로 나눠 넣어야 하는지. */
export function shouldSplitPastedNote(pasted: string): boolean {
  return containsNoteMarkers(pasted) || new RegExp(DATE_HEADER_PATTERN.source, "m").test(pasted);
}

/**
 * 붙여넣은 글을 탭에 나눠 넣는다. 날짜 제목이 있는 블록은 같은 날짜 탭이 있으면 그 탭에, 없으면 새 탭에 넣고,
 * 날짜 제목이 없는 블록은 지금 보고 있는 탭에 넣는다. 붙여넣은 값이 있는 칸은 붙여넣은 값이 우선한다.
 */
export function mergePastedNote(tabs: LectureNoteTab[], activeTabIndex: number, pasted: string): LectureNoteTab[] {
  const next = tabs.map((tab) => ({ ...tab }));

  for (const block of splitDateBlocks(pasted)) {
    const parsed = parseLectureNoteBody(block.body);
    const targetIndex = block.date ? next.findIndex((tab) => tab.date.trim() === block.date) : activeTabIndex;

    if (targetIndex === -1) {
      next.push({ ...blankTab(block.date), ...parsed });
      continue;
    }

    const target = next[targetIndex] ?? blankTab(block.date);
    next[targetIndex] = {
      ...target,
      courseSummary: parsed.courseSummary || target.courseSummary,
      issue: parsed.issue || target.issue,
      staffOpinion: parsed.staffOpinion || target.staffOpinion,
      studentCount: parsed.studentCount || target.studentCount
    };
  }

  return next;
}
