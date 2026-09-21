import { operationSubmissionSubjectConflict } from "@/lib/auth/operationSubmissionSubject";
import { operationCreationIdentity, creationOperationId, OperationCreationConflict } from "@/lib/data/operationCreationIdentity";
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server.js";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { isSameCourse, parseEducationDatesText } from "@/lib/data/operationCalculations";
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
  educationDates?: unknown;
  endDate?: unknown;
  instructors?: unknown;
  region?: unknown;
  roundNo?: unknown;
  startDate?: unknown;
  timeText?: unknown;
}

async function activityPOST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const subjectConflict = operationSubmissionSubjectConflict(request, session);
  if (subjectConflict) return subjectConflict;
  const { operationId } = await params;
  const repository = getOperationRepository();
  const body = (await request.json().catch(() => ({}))) as CreateRoundBody;
  let creationIdentity;
  try {
    creationIdentity = operationCreationIdentity(request.headers.get("Idempotency-Key"), session.user?.email,
      `/api/operations/${operationId}/rounds`, body);
  } catch {
    return NextResponse.json({ ok: false, error: "등록 요청 키와 로그인 정보를 확인해주세요." }, { status: 400 });
  }
  const replay = async () => {
    if (!creationIdentity) return null;
    const existing = await repository.getOperationById(creationOperationId(creationIdentity));
    return existing ? NextResponse.json({ ok: true, operation: { ...existing, creationReplayed: true } }) : null;
  };
  const previousResponse = await replay();
  if (previousResponse) return previousResponse;
  const baseOperation = await repository.getOperationById(operationId);

  if (!baseOperation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const roundNo = textValue(body.roundNo);
  const startDate = textValue(body.startDate);
  const endDate = textValue(body.endDate);
  const educationDatesText = textValue(body.educationDates);
  const parsedEducationDates = educationDatesText ? parseEducationDatesText(educationDatesText) : null;

  if (!roundNo || !startDate || !endDate) {
    return NextResponse.json({ ok: false, error: "회차, 시작일, 종료일은 필수입니다." }, { status: 400 });
  }

  if (parsedEducationDates && parsedEducationDates.errors.length > 0) {
    return NextResponse.json(
      { ok: false, error: `실제 교육일을 확인해주세요: ${parsedEducationDates.errors.join(", ")}` },
      { status: 400 }
    );
  }

  const allOperations = await repository.listOperations();
  const sameCourseOperations = allOperations.filter((candidate) => isSameCourse(candidate, baseOperation));
  const duplicateRound = sameCourseOperations.some((candidate) => candidate.roundNo === roundNo);

  if (duplicateRound) {
    const concurrentResponse = await replay();
    if (concurrentResponse) return concurrentResponse;
    return NextResponse.json(
      { ok: false, error: `이미 등록된 회차입니다 (${roundNo}회차). 엑셀 내용을 확인한 뒤 다시 시도해주세요.` },
      { status: 409 }
    );
  }

  const existingRoundNumbers = sameCourseOperations
    .map((candidate) => Number(candidate.roundNo))
    .filter((value) => Number.isFinite(value));
  const nextRoundNo = existingRoundNumbers.length > 0 ? Math.max(...existingRoundNumbers) + 1 : 1;
  const parsedRoundNo = Number(roundNo);

  if (!Number.isFinite(parsedRoundNo) || parsedRoundNo !== nextRoundNo) {
    return NextResponse.json(
      {
        ok: false,
        error: `회차는 같은 과정 안에서 순차적으로 입력해야 합니다. 다음 회차는 ${nextRoundNo}입니다 (입력값: ${roundNo}).`
      },
      { status: 400 }
    );
  }

  try {
    const operation = await repository.createOperation({
      creationIdentity,
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
      educationDates: parsedEducationDates?.dates,
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
      region: textValue(body.region) || baseOperation.region,
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
    const message = error instanceof Error ? error.message : "회차를 추가하지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: error instanceof OperationCreationConflict ? 409 : 400 });
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const POST = withActivity("/api/operations/[operationId]/rounds", "POST", activityPOST);
