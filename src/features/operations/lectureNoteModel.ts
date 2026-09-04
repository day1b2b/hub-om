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

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? value.length : value.length;

    return { body: value.slice(start, end).trim(), date: match[1].trim() };
  });
}

export function parseLectureNoteBody(value: string): LectureNoteDraft {
  const studentCountMatch = value.match(/학습\s*인원\s*[:：]\s*(.*)/);
  const studentCount = studentCountMatch ? studentCountMatch[1].trim() : "";
  const courseSummary = extractSection(value, COURSE_SUMMARY_MARKER, [STAFF_OPINION_MARKER, ISSUE_MARKER]);
  const staffOpinion = extractSection(value, STAFF_OPINION_MARKER, [ISSUE_MARKER]);
  const issue = extractSection(value, ISSUE_MARKER, []);

  if (!studentCount && !courseSummary && !staffOpinion && !issue && value.trim()) {
    return { courseSummary: value.trim(), issue: "", staffOpinion: "", studentCount: "" };
  }

  return { courseSummary, issue, staffOpinion, studentCount };
}

function extractSection(value: string, marker: string, followingMarkers: string[]): string {
  const startIndex = value.indexOf(marker);
  if (startIndex === -1) return "";

  const afterMarker = value.slice(startIndex + marker.length);
  const endIndex = followingMarkers
    .map((followingMarker) => afterMarker.indexOf(followingMarker))
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
  return Boolean(tab.date.trim() || tab.courseSummary.trim() || tab.staffOpinion.trim() || tab.issue.trim() || tab.studentCount.trim());
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

function hasBodyContent(tab: LectureNoteTab): boolean {
  return Boolean(tab.courseSummary.trim() || tab.staffOpinion.trim() || tab.issue.trim() || tab.studentCount.trim());
}

/**
 * 저장 직전 탭 정리. 내용은 있는데 날짜가 빈 탭(날짜 표기 이전의 옛 기록)만 시작일로 채우고,
 * 내용도 날짜도 없는 빈 탭은 버린다. 빈 탭까지 시작일로 채우면 첫 탭과 같은 날짜가 두 번 저장된다.
 */
export function prepareTabsForSave(tabs: LectureNoteTab[], startDate: string): LectureNoteTab[] {
  return tabs
    .filter((tab) => tab.date.trim() || hasBodyContent(tab))
    .map((tab) => ({ ...tab, date: tab.date.trim() || startDate }));
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

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;

  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}
