import type { ParsedImportRow } from "./importUploadParser";
import type { TeamMemberRoleRoster } from "./teamMemberRepository";
import { findUnknownAssigneeNames, findUnknownRoleAssigneeNames } from "./roleAssignees";

export function validateImportRows(rows: ParsedImportRow[], roleRoster: TeamMemberRoleRoster, instructorNames: string[]): ParsedImportRow[] {
  return rows.map((row) => ({
    ...row,
    validationErrors: [
      ...row.validationErrors,
      ...validateAssigneeFields(row.mappedFields, roleRoster),
      ...validateInstructorField(row.mappedFields, instructorNames)
    ]
  }));
}

export function planImportRows(rows: ParsedImportRow[], existingFingerprints: ReadonlySet<string>) {
  const seenInUpload = new Set<string>();
  const rowsToStore = rows.filter((row) => {
    if (existingFingerprints.has(row.sourceFingerprint) || seenInUpload.has(row.sourceFingerprint)) {
      return false;
    }

    seenInUpload.add(row.sourceFingerprint);
    return true;
  });
  const duplicateRows = rows.filter((row) => !rowsToStore.includes(row));
  const validationLogs = [
    ...buildValidationLogs(rowsToStore),
    ...duplicateRows.map((row) => ({
      rowNumber: row.rowNumber,
      errors: ["이미 같은 행이 저장되어 있어 중복 저장하지 않았습니다."]
    }))
  ];
  const errorCount = rowsToStore.filter((row) => row.validationErrors.length > 0).length + duplicateRows.length;
  return {
    rowsToStore,
    duplicateCount: duplicateRows.length,
    validationLogs,
    errorCount,
    successCount: rowsToStore.length - rowsToStore.filter((row) => row.validationErrors.length > 0).length
  };
}

function validateAssigneeFields(fields: Record<string, string>, roleRoster: TeamMemberRoleRoster) {
  const errors: string[] = [];

  if (!fields.om?.trim()) {
    errors.push("담당OM 정보가 없습니다.");
  }

  if (!fields.ld?.trim()) {
    errors.push("담당LD 정보가 없습니다.");
  }

  const unknownOm = findUnknownRoleAssigneeNames(fields.om ?? "", "om", roleRoster);
  const unknownLd = findUnknownRoleAssigneeNames(fields.ld ?? "", "ld", roleRoster);

  if (unknownOm.length > 0) {
    errors.push(`담당OM에 멤버 관리(팀 유저)에 없는 이름이 있습니다: ${unknownOm.join(", ")}`);
  }

  if (unknownLd.length > 0) {
    errors.push(`담당LD에 멤버 관리(팀 유저)에 없는 이름이 있습니다: ${unknownLd.join(", ")}`);
  }

  return errors;
}

function validateInstructorField(fields: Record<string, string>, instructorNames: string[]) {
  const errors: string[] = [];
  const unknownInstructors = findUnknownAssigneeNames(fields.instructors ?? "", instructorNames);

  if (unknownInstructors.length > 0) {
    errors.push(`강사에 강사DB 노션에 없는 이름이 있습니다: ${unknownInstructors.join(", ")}`);
  }

  return errors;
}

function buildValidationLogs(rows: Array<{ rowNumber: number; validationErrors: string[] }>) {
  return rows
    .filter((row) => row.validationErrors.length > 0)
    .map((row) => ({
      rowNumber: row.rowNumber,
      errors: row.validationErrors
    }));
}
