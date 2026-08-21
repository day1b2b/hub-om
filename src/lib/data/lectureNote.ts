export const ISSUE_TAG_OPTIONS = ["자료", "장비", "커뮤니케이션", "일정", "강사", "학습자", "시설/환경", "기타"] as const;

export interface LectureNoteDraft {
  courseSummary: string;
  issue: string;
  issueTags: string[];
  staffOpinion: string;
  studentCount: string;
}

export interface LectureNoteTab extends LectureNoteDraft {
  date: string;
}

const COURSE_SUMMARY_MARKER = "[강의 요약]";
const STAFF_OPINION_MARKER = "[운영진 의견]";
const ISSUE_TAGS_MARKER = "[이슈 유형]";
const ISSUE_MARKER = "[이슈]";
const DATE_HEADER_PATTERN = /^\[날짜:\s*(.*?)\]\s*$/gm;

export function blankLectureNoteTab(defaultDate: string = ""): LectureNoteTab {
  return { courseSummary: "", date: defaultDate, issue: "", issueTags: [], staffOpinion: "", studentCount: "" };
}

export function containsLectureNoteMarkers(value: string): boolean {
  return (
    value.includes(COURSE_SUMMARY_MARKER) ||
    value.includes(STAFF_OPINION_MARKER) ||
    value.includes(ISSUE_TAGS_MARKER) ||
    value.includes(ISSUE_MARKER)
  );
}

export function parseLectureNote(value: string, defaultDate: string): LectureNoteTab[] {
  const blocks = splitDateBlocks(value);
  const tabs = blocks.map((block) => ({ date: block.date, ...parseLectureNoteBody(block.body) }));

  if (tabs.length === 0) return [blankLectureNoteTab(defaultDate)];
  if (tabs.length === 1 && !tabs[0].date.trim() && !hasLectureNoteTabContent(tabs[0])) return [blankLectureNoteTab(defaultDate)];

  return tabs;
}

export function extractIssueTagsFromNote(value: string): string[] {
  if (!value.trim()) return [];
  return parseLectureNote(value, "").flatMap((tab) => tab.issueTags);
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
  const courseSummary = extractSection(value, COURSE_SUMMARY_MARKER, [STAFF_OPINION_MARKER, ISSUE_TAGS_MARKER, ISSUE_MARKER]);
  const staffOpinion = extractSection(value, STAFF_OPINION_MARKER, [ISSUE_TAGS_MARKER, ISSUE_MARKER]);
  const issueTags = parseIssueTagsSection(extractSection(value, ISSUE_TAGS_MARKER, [ISSUE_MARKER]));
  const issue = extractSection(value, ISSUE_MARKER, []);

  if (!studentCount && !courseSummary && !staffOpinion && !issue && issueTags.length === 0 && value.trim()) {
    return { courseSummary: value.trim(), issue: "", issueTags: [], staffOpinion: "", studentCount: "" };
  }

  return { courseSummary, issue, issueTags, staffOpinion, studentCount };
}

function parseIssueTagsSection(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
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
  const meaningfulTabs = tabs.filter((tab) => hasLectureNoteTabContent(tab));

  if (meaningfulTabs.length === 0) return "";

  if (meaningfulTabs.length === 1 && !meaningfulTabs[0].date.trim()) {
    return composeLectureNoteBody(meaningfulTabs[0]);
  }

  return meaningfulTabs
    .map((tab) => `[날짜: ${tab.date.trim()}]\n${composeLectureNoteBody(tab)}`.trim())
    .join("\n\n");
}

export function hasLectureNoteTabContent(tab: LectureNoteTab): boolean {
  return Boolean(
    tab.date.trim() ||
      tab.courseSummary.trim() ||
      tab.staffOpinion.trim() ||
      tab.issue.trim() ||
      tab.studentCount.trim() ||
      tab.issueTags.length > 0
  );
}

function composeLectureNoteBody(draft: LectureNoteDraft): string {
  const sections = [
    draft.studentCount.trim() ? `학습 인원: ${draft.studentCount.trim()}` : "",
    draft.courseSummary.trim() ? `${COURSE_SUMMARY_MARKER}\n${draft.courseSummary.trim()}` : "",
    draft.staffOpinion.trim() ? `${STAFF_OPINION_MARKER}\n${draft.staffOpinion.trim()}` : "",
    draft.issueTags.length > 0 ? `${ISSUE_TAGS_MARKER}\n${draft.issueTags.join(", ")}` : "",
    draft.issue.trim() ? `${ISSUE_MARKER}\n${draft.issue.trim()}` : ""
  ].filter(Boolean);

  return sections.join("\n\n");
}
