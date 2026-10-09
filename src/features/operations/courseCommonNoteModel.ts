import type { CourseCommonNote } from "@/lib/data/operationTypes";

const NOTE_FIELDS = [
  ["specialNotes", "특이사항 / 이슈"],
  ["operationIssue", "회고 (OM+LD)"],
  ["omUpdate", "메모"]
] as const;

export function commonNoteEntries(note: CourseCommonNote) {
  return NOTE_FIELDS.map(([field, label]) => ({ label, value: note[field].trim() })).filter((entry) => entry.value.length > 0);
}
