import type { CourseCommonNoteInput, OperationSession } from "./operationTypes";

const FIELDS = ["specialNotes", "operationIssue", "omUpdate"] as const;
type Field = (typeof FIELDS)[number];

function normalized(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function roundLabelGroup(roundNos: string[]): string {
  return `${roundNos.map((roundNo) => roundNo.trim() || "미정").join(",")}회차`;
}

/**
 * roundNo를 가능하면 숫자로, 아니면 원래 문자열 순서로 비교해 회차 라벨이
 * "[1회차] ... [2회차] ..." 순으로 나오게 한다. 숫자로 못 바꾸면 원래 순서를 유지한다(stable).
 */
function compareRoundNo(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a.trim() && String(nb) === b.trim()) return na - nb;
  return 0;
}

/**
 * 과정 공통 메모 1개 필드와, 같은 과정의 회차별 같은 필드 값들을 합쳐 최종 과정 공통 값을 만든다.
 *
 * 규칙:
 * - 비어 있는 값(공통/회차 모두)은 무시한다.
 * - 과정 공통 값과 회차별 값을 모아 완전히 같은 문자열은 한 번만 남긴다.
 * - 회차별 값이 서로 다르면(전부 같지 않으면) 어느 회차에서 왔는지 "[N회차]" 접두사를 붙인다.
 *   과정 공통에만 있던 값, 그리고 회차별 값이 전부 같을 때는 접두사를 붙이지 않는다.
 * - 과정 공통 값에 이미 들어있는 줄(개행 기준)과 완전히 같은 내용은 다시 추가하지 않는다
 *   (재실행 시 중복 증식을 막기 위한 최소 멱등성 — 값 전체가 아니라 "줄" 단위 비교라서,
 *   회차 값 자체에 개행이 포함된 경우까지는 완전히 막지 못한다. 자세한 내용은
 *   docs/operations/merge-course-and-round-notes.md 참고).
 */
export function mergeCourseAndRoundNoteField(
  commonValue: string,
  roundValues: Array<{ roundNo: string; value: string }>
): { value: string; changed: boolean } {
  const common = normalized(commonValue);
  const existingLines = new Set(common.length > 0 ? common.split("\n").map((line) => line.trim()).filter(Boolean) : []);

  const roundEntries = roundValues
    .map((entry) => ({ roundNo: entry.roundNo, value: normalized(entry.value) }))
    .filter((entry) => entry.value.length > 0);

  if (roundEntries.length === 0) return { value: common, changed: false };

  const distinctRoundValues = new Set(roundEntries.map((entry) => entry.value));
  const appended: string[] = [];

  if (distinctRoundValues.size === 1) {
    const value = roundEntries[0].value;
    if (!existingLines.has(value)) appended.push(value);
  } else {
    const roundNosByValue = new Map<string, string[]>();
    for (const entry of roundEntries) {
      const list = roundNosByValue.get(entry.value) ?? [];
      list.push(entry.roundNo);
      roundNosByValue.set(entry.value, list);
    }
    const orderedValues = [...roundNosByValue.entries()].sort(
      ([, a], [, b]) => compareRoundNo(a[0] ?? "", b[0] ?? "")
    );
    for (const [value, roundNos] of orderedValues) {
      const label = roundLabelGroup([...roundNos].sort(compareRoundNo));
      const line = `[${label}] ${value}`;
      if (existingLines.has(line) || existingLines.has(value)) continue;
      appended.push(line);
    }
  }

  if (appended.length === 0) return { value: common, changed: false };
  const merged = [common, ...appended].filter((line) => line.length > 0).join("\n");
  return { value: merged, changed: merged !== common };
}

export interface MergeCourseAndRoundNotesFieldSummary {
  unchanged: number;
  merged: number;
}

export interface MergeCourseAndRoundNotesCourseCandidate {
  courseRecordId: string;
  input: CourseCommonNoteInput;
  changedFields: Field[];
}

export interface MergeCourseAndRoundNotesPlan {
  courseCount: number;
  summaryByField: Record<Field, MergeCourseAndRoundNotesFieldSummary>;
  candidates: MergeCourseAndRoundNotesCourseCandidate[];
}

/**
 * 과정별로 specialNotes/operationIssue/omUpdate 3개 필드를 각각 독립적으로
 * "과정 공통 값 + 회차별 값들"을 합쳐 최종 과정 공통 값을 만드는 계획을 세운다.
 * 회차별 원본 값은 이 계획에서 바꾸지 않는다(add-only) — 실제 반영은 course_common_notes에만 쓴다.
 */
export function planMergeCourseAndRoundNotes(operations: OperationSession[]): MergeCourseAndRoundNotesPlan {
  const courses = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    if (!operation.courseRecordId) continue;
    const group = courses.get(operation.courseRecordId) ?? [];
    group.push(operation);
    courses.set(operation.courseRecordId, group);
  }

  const summaryByField: Record<Field, MergeCourseAndRoundNotesFieldSummary> = {
    specialNotes: { unchanged: 0, merged: 0 },
    operationIssue: { unchanged: 0, merged: 0 },
    omUpdate: { unchanged: 0, merged: 0 }
  };
  const candidates: MergeCourseAndRoundNotesCourseCandidate[] = [];

  for (const [courseRecordId, rounds] of courses) {
    const existing = rounds.find((round) => round.courseCommonNote)?.courseCommonNote;
    const input: CourseCommonNoteInput = {
      specialNotes: existing?.specialNotes ?? "",
      operationIssue: existing?.operationIssue ?? "",
      omUpdate: existing?.omUpdate ?? ""
    };
    const changedFields: Field[] = [];

    for (const field of FIELDS) {
      const roundValues = rounds.map((round) => ({ roundNo: round.roundNo, value: round[field] }));
      const result = mergeCourseAndRoundNoteField(input[field], roundValues);
      input[field] = result.value;
      if (result.changed) {
        summaryByField[field].merged++;
        changedFields.push(field);
      } else {
        summaryByField[field].unchanged++;
      }
    }

    if (changedFields.length > 0) candidates.push({ courseRecordId, input, changedFields });
  }

  return { courseCount: courses.size, summaryByField, candidates };
}
