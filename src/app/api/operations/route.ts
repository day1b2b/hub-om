import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { CreateOperationInput, OnsiteRequired } from "@/lib/data/operationTypes";

export const dynamic = "force-dynamic";

const ONSITE_REQUIRED: OnsiteRequired[] = ["UNKNOWN", "Y", "N", "PARTIAL"];

interface CreateCourseBody {
  coach?: unknown;
  companyName?: unknown;
  courseId?: unknown;
  courseName?: unknown;
  driveLink?: unknown;
  educationDays?: unknown;
  endDate?: unknown;
  instructors?: unknown;
  ld?: unknown;
  om?: unknown;
  onsiteRequired?: unknown;
  operationDetail?: unknown;
  region?: unknown;
  roundNo?: unknown;
  startDate?: unknown;
  timeText?: unknown;
}

export async function POST(request: Request) {
  const session = await requireWorkspaceSession();
  const repository = getOperationRepository();
  const body = (await request.json().catch(() => ({}))) as CreateCourseBody;

  const companyName = textValue(body.companyName);
  const courseName = textValue(body.courseName);
  const roundNo = textValue(body.roundNo);
  const startDate = textValue(body.startDate);
  const endDate = textValue(body.endDate);

  if (!companyName || !courseName) {
    return NextResponse.json({ ok: false, error: "기업명과 과정명은 필수입니다." }, { status: 400 });
  }

  if (!roundNo || !startDate || !endDate) {
    return NextResponse.json({ ok: false, error: "회차, 시작일, 종료일은 필수입니다." }, { status: 400 });
  }

  try {
    const operation = await repository.createOperation({
      archiveStatus: "아카이빙전",
      coach: textValue(body.coach),
      companyName,
      companyWikiLink: "",
      costRaw: "",
      courseId: textValue(body.courseId),
      courseName,
      createdBy: session.user?.email ?? undefined,
      driveLink: textValue(body.driveLink),
      educationDays: textValue(body.educationDays),
      educationFormat: "검토필요",
      endDate,
      instructorCost: null,
      instructorWikiLink: "",
      instructors: textValue(body.instructors),
      ld: textValue(body.ld),
      lectureManagementLink: "",
      om: textValue(body.om),
      onsiteRequired: enumValue(body.onsiteRequired, ONSITE_REQUIRED, "UNKNOWN"),
      operationCost: null,
      operationDetail: textValue(body.operationDetail),
      operationIssue: "",
      operationStatus: "배정필요",
      operationType: "검토필요",
      padletLink: "",
      region: textValue(body.region),
      resultReportLink: "",
      revenue: null,
      roundNo,
      specialNotes: "",
      startDate,
      timeText: textValue(body.timeText),
      totalCost: null
    } satisfies CreateOperationInput);

    return NextResponse.json({ ok: true, operation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "과정을 등록하지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function enumValue<T extends string>(value: unknown, allowedValues: T[], fallback: T): T {
  return typeof value === "string" && allowedValues.includes(value as T) ? (value as T) : fallback;
}
