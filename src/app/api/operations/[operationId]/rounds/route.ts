import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { isSameCourse } from "@/lib/data/operationCalculations";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { CreateOperationInput } from "@/lib/data/operationTypes";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    operationId: string;
  }>;
}

interface CreateRoundBody {
  coach?: unknown;
  endDate?: unknown;
  instructors?: unknown;
  roundNo?: unknown;
  startDate?: unknown;
  timeText?: unknown;
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { operationId } = await params;
  const repository = getOperationRepository();
  const baseOperation = await repository.getOperationById(operationId);

  if (!baseOperation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateRoundBody;
  const roundNo = textValue(body.roundNo);
  const startDate = textValue(body.startDate);
  const endDate = textValue(body.endDate);

  if (!roundNo || !startDate || !endDate) {
    return NextResponse.json({ ok: false, error: "회차, 시작일, 종료일은 필수입니다." }, { status: 400 });
  }

  const allOperations = await repository.listOperations();
  const duplicateRound = allOperations.some(
    (candidate) => isSameCourse(candidate, baseOperation) && candidate.roundNo === roundNo
  );

  if (duplicateRound) {
    return NextResponse.json(
      { ok: false, error: `이미 등록된 회차입니다 (${roundNo}회차). 엑셀 내용을 확인한 뒤 다시 시도해주세요.` },
      { status: 409 }
    );
  }

  try {
    const operation = await repository.createOperation({
      archiveStatus: "아카이빙전",
      coach: textValue(body.coach) || baseOperation.coach,
      companyName: baseOperation.companyName,
      companyWikiLink: baseOperation.companyWikiLink,
      costRaw: "",
      courseId: baseOperation.courseId,
      courseName: baseOperation.courseName,
      createdBy: session.user?.email ?? undefined,
      driveLink: "",
      educationDays: baseOperation.educationDays,
      educationFormat: baseOperation.educationFormat,
      endDate,
      instructorCost: null,
      instructorWikiLink: baseOperation.instructorWikiLink,
      instructors: textValue(body.instructors) || baseOperation.instructors,
      ld: baseOperation.ld,
      lectureManagementLink: "",
      om: baseOperation.om,
      onsiteRequired: baseOperation.onsiteRequired,
      operationCost: null,
      operationDetail: baseOperation.operationDetail,
      operationIssue: "",
      operationStatus: "배정예정",
      operationType: baseOperation.operationType,
      padletLink: baseOperation.padletLink,
      region: baseOperation.region,
      resultReportLink: "",
      revenue: baseOperation.revenue,
      roundNo,
      specialNotes: "",
      startDate,
      timeText: textValue(body.timeText) || baseOperation.timeText,
      totalCost: null
    } satisfies CreateOperationInput);

    return NextResponse.json({ ok: true, operation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "차수를 추가하지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
