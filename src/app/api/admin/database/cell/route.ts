import { NextResponse } from "next/server";
import {
  ArchiveStatus,
  EducationFormat,
  MemberRole,
  OnsiteRequired,
  OperationChannel,
  OperationStatus,
  OperationType,
  ResultReportStatus,
  SourceTeam
} from "@prisma/client";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getAdminEditableField, type AdminDatabaseTableKey, type AdminEditableField } from "@/lib/admin/databaseEditConfig";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

type RequestBody = {
  field?: unknown;
  rowId?: unknown;
  table?: unknown;
  value?: unknown;
};

const ENUM_VALUES: Record<string, readonly string[]> = {
  archiveStatus: Object.values(ArchiveStatus),
  educationFormat: Object.values(EducationFormat),
  hasResultReport: Object.values(ResultReportStatus),
  operationChannel: Object.values(OperationChannel),
  operationStatus: Object.values(OperationStatus),
  operationType: Object.values(OperationType),
  onsiteRequired: Object.values(OnsiteRequired),
  role: ["", ...Object.values(MemberRole)],
  sourceTeam: ["", ...Object.values(SourceTeam)]
};

export async function PATCH(request: Request) {
  const session = await requireAdminSession();
  const body = (await request.json().catch(() => ({}))) as RequestBody;

  if (typeof body.table !== "string" || typeof body.rowId !== "string" || typeof body.field !== "string") {
    return NextResponse.json({ ok: false, error: "수정 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const editableField = getAdminEditableField(body.table, body.field);

  if (!editableField) {
    return NextResponse.json({ ok: false, error: "이 항목은 읽기 전용입니다." }, { status: 403 });
  }

  const parsedValue = parseEditableValue(editableField, body.value);
  if (!parsedValue.ok) {
    return NextResponse.json({ ok: false, error: parsedValue.error }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const updatedBy = session.user?.email ?? null;

  await updateCell({
    field: body.field,
    rowId: body.rowId,
    table: body.table as AdminDatabaseTableKey,
    updatedBy,
    value: parsedValue.value
  });

  return NextResponse.json({ ok: true });

  async function updateCell(input: {
    field: string;
    rowId: string;
    table: AdminDatabaseTableKey;
    updatedBy: string | null;
    value: boolean | Date | number | string | null;
  }) {
    if (input.table === "companies") {
      await prisma.company.update({
        data: input.field === "name"
          ? { name: String(input.value), normalizedName: normalizeName(String(input.value)) }
          : { [input.field]: input.value },
        where: { id: input.rowId }
      });
      return;
    }

    if (input.table === "courses") {
      await prisma.course.update({
        data: { [input.field]: input.value },
        where: { id: input.rowId }
      });
      return;
    }

    if (input.table === "members") {
      await prisma.member.update({
        data: input.field === "name"
          ? { name: String(input.value), normalizedName: normalizeName(String(input.value)) }
          : { [input.field]: input.value },
        where: { id: input.rowId }
      });
      return;
    }

    await prisma.operationSession.update({
      data: {
        [input.field]: input.value,
        updatedBy: input.updatedBy
      },
      where: { id: input.rowId }
    });
  }
}

function parseEditableValue(field: AdminEditableField, value: unknown):
  | { ok: true; value: boolean | Date | number | string | null }
  | { ok: false; error: string } {
  const text = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();

  if (!text && field.nullable) {
    return { ok: true, value: null };
  }

  if (!text && !field.nullable && field.input !== "boolean") {
    return { ok: false, error: `${field.label}은 필수값입니다.` };
  }

  if (field.input === "boolean") {
    if (text === "true") return { ok: true, value: true };
    if (text === "false") return { ok: true, value: false };
    return { ok: false, error: `${field.label} 값이 올바르지 않습니다.` };
  }

  if (field.input === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return { ok: false, error: `${field.label}은 YYYY-MM-DD 형식이어야 합니다.` };

    const date = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return { ok: false, error: `${field.label} 날짜가 올바르지 않습니다.` };
    return { ok: true, value: date };
  }

  if (field.input === "enum") {
    const values = ENUM_VALUES[field.field] ?? field.options ?? [];
    if (!values.includes(text)) {
      return { ok: false, error: `${field.label} 값이 지원되지 않습니다.` };
    }

    return { ok: true, value: text || null };
  }

  if (field.input === "integer") {
    const parsed = Number(text);
    if (!Number.isInteger(parsed)) return { ok: false, error: `${field.label}은 정수로 입력해야 합니다.` };
    return { ok: true, value: parsed };
  }

  if (field.input === "money") {
    const parsed = Number(text.replaceAll(",", ""));
    if (!Number.isFinite(parsed)) return { ok: false, error: `${field.label}은 숫자로 입력해야 합니다.` };
    return { ok: true, value: parsed };
  }

  return { ok: true, value: text };
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
