"use server";

import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type {
  ArchiveStatus,
  CreateOperationInput,
  EducationFormat,
  OnsiteRequired,
  OperationStatus,
  OperationType
} from "@/lib/data/operationTypes";
import { normalizeRoleAssigneeText } from "@/lib/data/roleAssignees";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { parseTeamScope, teamScopeSearchParam } from "@/lib/teamScope";

const OPERATION_STATUSES: OperationStatus[] = ["배정필요", "배정예정", "진행중", "완료", "회고완료", "아카이빙필요"];
const ARCHIVE_STATUSES: ArchiveStatus[] = ["아카이빙전", "아카이빙필요", "완료"];
const EDUCATION_FORMATS: EducationFormat[] = ["오프라인", "비대면", "블렌디드", "플립러닝", "검토필요"];
const OPERATION_TYPES: OperationType[] = ["특강", "단기", "중기", "중장기", "준장기", "장기", "연간", "상시형", "검토필요"];
const ONSITE_REQUIRED: OnsiteRequired[] = ["UNKNOWN", "Y", "N", "PARTIAL"];

export async function createOperationAction(formData: FormData) {
  const session = await requireWorkspaceSession();
  const repository = getOperationRepository();
  const roleRoster = await getStoredTeamMemberRepository().listRoleRosters();
  const teamScope = parseTeamScope(textValue(formData, "teamScope")) ?? "both";
  const operation = await repository.createOperation({
    archiveStatus: enumValue(formData, "archiveStatus", ARCHIVE_STATUSES, "아카이빙전"),
    coach: textValue(formData, "coach"),
    companyName: requiredTextValue(formData, "companyName"),
    companyWikiLink: textValue(formData, "companyWikiLink"),
    costRaw: textValue(formData, "costRaw"),
    courseId: textValue(formData, "courseId"),
    courseName: requiredTextValue(formData, "courseName"),
    createdBy: session.user?.email ?? undefined,
    driveLink: textValue(formData, "driveLink"),
    educationDays: textValue(formData, "educationDays"),
    educationFormat: enumValue(formData, "educationFormat", EDUCATION_FORMATS, "검토필요"),
    endDate: requiredTextValue(formData, "endDate"),
    instructorCost: moneyValue(formData, "instructorCost"),
    instructorWikiLink: textValue(formData, "instructorWikiLink"),
    instructors: textValue(formData, "instructors"),
    ld: normalizeRoleAssigneeText(textValue(formData, "ld"), "ld", roleRoster),
    lectureManagementLink: textValue(formData, "lectureManagementLink"),
    om: normalizeRoleAssigneeText(textValue(formData, "om"), "om", roleRoster),
    onsiteRequired: enumValue(formData, "onsiteRequired", ONSITE_REQUIRED, "UNKNOWN"),
    operationCost: moneyValue(formData, "operationCost"),
    operationDetail: requiredTextValue(formData, "operationDetail"),
    operationIssue: textValue(formData, "operationIssue"),
    operationStatus: enumValue(formData, "operationStatus", OPERATION_STATUSES, "배정필요"),
    operationType: enumValue(formData, "operationType", OPERATION_TYPES, "검토필요"),
    padletLink: textValue(formData, "padletLink"),
    region: textValue(formData, "region"),
    resultReportLink: textValue(formData, "resultReportLink"),
    revenue: moneyValue(formData, "revenue"),
    roundNo: textValue(formData, "roundNo"),
    specialNotes: textValue(formData, "specialNotes"),
    startDate: requiredTextValue(formData, "startDate"),
    timeText: textValue(formData, "timeText"),
    totalCost: moneyValue(formData, "totalCost")
  } satisfies CreateOperationInput);

  redirect(`/operations/${operation.operationId}${teamScopeSearchParam(teamScope)}`);
}

function textValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredTextValue(formData: FormData, key: string): string {
  const value = textValue(formData, key);

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function moneyValue(formData: FormData, key: string): number | null {
  const value = textValue(formData, key).replaceAll(",", "");
  if (!value) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number.`);
  }

  return parsed;
}

function enumValue<T extends string>(formData: FormData, key: string, allowedValues: T[], fallback: T): T {
  const value = textValue(formData, key);
  return allowedValues.includes(value as T) ? (value as T) : fallback;
}
