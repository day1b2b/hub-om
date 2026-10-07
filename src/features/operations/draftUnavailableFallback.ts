import { isNavigableHref, toHref } from "@/lib/links";
import type { OperationSession } from "@/lib/data/operationTypes";

export const LOCKED_ISSUE_FIELDS = [
  { field: "specialNotes", label: "특이사항 / 이슈" },
  { field: "operationIssue", label: "회고 (OM+LD)" },
  { field: "omUpdate", label: "메모" }
] as const;

export function lockedSavedHref(value: string): string | null {
  return isNavigableHref(value) ? toHref(value) : null;
}

export function lockedIssueValues(operation: OperationSession) {
  return LOCKED_ISSUE_FIELDS.map(({ field, label }) => ({ field, label, value: operation[field] }));
}
