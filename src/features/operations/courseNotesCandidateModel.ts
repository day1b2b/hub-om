import type { OperationSession } from "@/lib/data/operationTypes";

const NOTE_FIELDS = [
  ["specialNotes", "특이사항 / 이슈"],
  ["operationIssue", "회고 (OM+LD)"],
  ["omUpdate", "메모"]
] as const;

export type CourseNoteCandidate = {
  field: (typeof NOTE_FIELDS)[number][0];
  label: string;
  values: Array<{ roundNo: string; value: string }>;
  commonCandidate: boolean;
};

export function getCourseNoteCandidates(operations: OperationSession[]): CourseNoteCandidate[] {
  return NOTE_FIELDS.map(([field, label]) => {
    const values = operations
      .map((operation) => ({ roundNo: operation.roundNo || "미정", value: operation[field].trim() }))
      .filter((item) => item.value.length > 0);
    const uniqueValues = new Set(values.map((item) => item.value));
    return { field, label, values, commonCandidate: uniqueValues.size === 1 && values.length >= 2 };
  });
}
