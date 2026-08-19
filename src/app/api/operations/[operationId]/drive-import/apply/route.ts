import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type {
  ArchiveStatus,
  OperationSession,
  ResultReportStatus,
  SatisfactionSurveyStatus,
  UpdateOperationInput
} from "@/lib/data/operationTypes";
import { summarizeSatisfactionValue } from "@/lib/data/satisfaction";
import type { DriveImportCandidateAction, DriveImportCandidateField } from "@/lib/driveImports/driveImportTypes";

export const dynamic = "force-dynamic";

const APPLYABLE_FIELDS = [
  "archiveStatus",
  "avgSatisfaction",
  "coach",
  "companyWikiLink",
  "costRaw",
  "courseCategory",
  "courseId",
  "courseName",
  "driveLink",
  "educationDays",
  "endDate",
  "hasResultReport",
  "hasSatisfactionSurvey",
  "instructorCost",
  "instructorSatisfaction",
  "instructors",
  "instructorWikiLink",
  "ld",
  "lectureManagementLink",
  "lectureManagementNote",
  "om",
  "onsiteOm",
  "operationCost",
  "operationDetail",
  "operationIssue",
  "omUpdate",
  "padletLink",
  "region",
  "resultReportLink",
  "specialNotes",
  "startDate",
  "timeText",
  "tools",
  "totalCost"
] as const satisfies Array<keyof UpdateOperationInput>;

type ApplyableField = (typeof APPLYABLE_FIELDS)[number];

interface RouteContext {
  params: Promise<{
    operationId: string;
  }>;
}

interface ApplyPatch {
  field?: DriveImportCandidateField;
  value?: unknown;
  action?: DriveImportCandidateAction;
}

export async function POST(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);

  if (!operation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { patches?: ApplyPatch[] };
  const patches = Array.isArray(body.patches) ? body.patches : [];
  const update: UpdateOperationInput = {};

  for (const patch of patches) {
    if (!isApplyableField(patch.field) || typeof patch.value !== "string") continue;

    const currentValue = currentOperationValue(operation, patch.field);
    const nextValue = patch.action === "append" ? appendText(currentValue, patch.value) : patch.value;

    assignUpdateValue(update, patch.field, nextValue);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: "No supported fields selected." }, { status: 400 });
  }

  const updatedOperation = await repository.updateOperation(operationId, update);

  return NextResponse.json({ ok: true, operation: updatedOperation });
}

function isApplyableField(value: unknown): value is ApplyableField {
  return typeof value === "string" && APPLYABLE_FIELDS.includes(value as ApplyableField);
}

function currentOperationValue(operation: OperationSession, field: ApplyableField): string {
  const value = operation[field];
  if (value === null || value === undefined) return "";

  return String(value);
}

function assignUpdateValue(update: UpdateOperationInput, field: ApplyableField, value: string) {
  if (field === "archiveStatus") {
    if (isArchiveStatus(value)) update.archiveStatus = value;
    return;
  }

  if (field === "hasResultReport") {
    if (isResultReportStatus(value)) update.hasResultReport = value;
    return;
  }

  if (field === "hasSatisfactionSurvey") {
    if (isSatisfactionSurveyStatus(value)) update.hasSatisfactionSurvey = value;
    return;
  }

  if (field === "startDate" || field === "endDate") {
    if (isDateText(value)) update[field] = value;
    return;
  }

  if (isMoneyField(field)) {
    update[field] = parseMoney(value);
    return;
  }

  if (isSatisfactionField(field)) {
    update[field] = summarizeSatisfactionValue(value);
    return;
  }

  update[field] = value;
}

function isArchiveStatus(value: string): value is ArchiveStatus {
  return value === "아카이빙전" || value === "아카이빙필요" || value === "완료";
}

function isResultReportStatus(value: string): value is ResultReportStatus {
  return value === "유" || value === "무" || value === "불필요" || value === "확인필요";
}

function isSatisfactionSurveyStatus(value: string): value is SatisfactionSurveyStatus {
  return value === "불필요" || value === "확인필요";
}

function isDateText(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function isMoneyField(field: ApplyableField): field is "instructorCost" | "operationCost" | "totalCost" {
  return field === "instructorCost" || field === "operationCost" || field === "totalCost";
}

function isSatisfactionField(field: ApplyableField): field is "avgSatisfaction" | "instructorSatisfaction" {
  return field === "avgSatisfaction" || field === "instructorSatisfaction";
}

function parseMoney(value: string): number | null {
  const normalized = value.replaceAll(",", "").trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function appendText(currentValue: string, nextValue: string): string {
  const current = currentValue.trim();
  const next = nextValue.trim();

  if (!current) return next;
  if (!next) return current;
  if (current.includes(next)) return current;

  return `${current}\n\n${next}`;
}
