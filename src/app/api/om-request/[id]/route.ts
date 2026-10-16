import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/auth/requireAdminSession";
import { addCustomTools, listCustomTools, getOmCustomToolsRepository } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { deleteOmRequest, getOmRequest, setOmRequestOperationId, updateOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import { syncOmRequestSessionsToOperations } from "@/lib/data/omRequest/omRequestOperationLink";
import { planSessionCountChange, sessionScheduleChanged } from "@/lib/data/omRequest/omRequestSessionPlan";
import { isOmRequestAuthor, type OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";
import { extractUnknownTools } from "@/lib/data/omRequest/omToolOptions";
import { runOmRequestWriteRequest } from "@/lib/data/omRequestWriteComposition";

interface Props {
  params: Promise<{ id: string }>;
}

async function resolveRequestEmail(): Promise<string | undefined> {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return process.env.DEV_AUTH_EMAIL ?? undefined;
  }
  const session = await auth();
  return session?.user?.email ?? undefined;
}

async function activityPATCH(request: Request, { params }: Props) {
  try {
    const { id } = await params;
    const existing = await getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    const email = await resolveRequestEmail();
    if (!isAdminEmail(email) && !isOmRequestAuthor(existing, email)) {
      return NextResponse.json({ error: "본인이 작성한 요청만 수정할 수 있습니다." }, { status: 403 });
    }

    // 관리자도 OM 배정 후에는 수정할 수 없다. 배정 후 변경은 담당 OM이 운영현황에서 직접 한다.
    if (existing.status === "배정완료") {
      return NextResponse.json({ error: "OM 배정이 끝난 요청은 수정할 수 없습니다. 변경이 필요하면 담당 OM에게 운영현황 수정을 요청해 주세요." }, { status: 403 });
    }

    getOmCustomToolsRepository();
    const { sessionOrigins, ...body } = (await request.json()) as OmRequestInput & { sessionOrigins?: unknown };
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    const input = { ...body, sessions, totalSessions: sessions.length };

    // 운영현황에 연결된 요청만 회차 증감·일정 변경을 운영현황·캘린더에 맞춘다. 연결 전 요청은 요청만 고친다.
    if (existing.operationId) {
      const plan = planSessionCountChange(existing.sessions.length, sessions.length, sessionOrigins);
      if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });
      // 새로 추가한 회차는 운영현황 회차와 캘린더 일정을 바로 만들므로 일정·시간·장소가 모두 있어야 한다.
      const incomplete = plan.origins.findIndex((origin, i) => origin === null && !(sessions[i]?.date && sessions[i]?.timeStart && sessions[i]?.timeEnd && sessions[i]?.location?.trim()));
      if (incomplete !== -1) {
        return NextResponse.json({ error: `${incomplete + 1}회차의 교육일·시작 시간·종료 시간·장소를 모두 입력해 주세요.` }, { status: 400 });
      }
      const scheduleChanged = plan.origins.some((origin, i) => origin !== null && sessionScheduleChanged(existing.sessions[origin], sessions[i]));
      if (plan.changed || scheduleChanged) {
        try {
          const firstOperationId = await syncOmRequestSessionsToOperations(existing, { ...existing, ...input }, plan.origins, email);
          if (firstOperationId !== existing.operationId) await setOmRequestOperationId(id, firstOperationId);
        } catch (error) {
          if (error instanceof Error && error.message === "OPERATION_ROUND_MISMATCH") {
            return NextResponse.json({ error: "운영현황의 회차 수가 요청과 달라 회차를 바꿀 수 없습니다. 관리자에게 확인을 요청해 주세요." }, { status: 409 });
          }
          console.error("[om-request] OPERATION_ROUND_SYNC_FAILED");
          return NextResponse.json({ error: "운영현황 회차 반영에 실패했습니다. 운영현황을 확인한 뒤 다시 시도해 주세요." }, { status: 500 });
        }
      }
    }
    const updated = await updateOmRequest(id, input);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    try {
      addCustomTools(extractUnknownTools(updated.tools ?? "", listCustomTools()));
    } catch {
      console.error("[om-request] 커스텀 툴 저장 실패(무시):");
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

async function activityDELETE(_request: Request, { params }: Props) {
  try {
    const { id } = await params;
    const existing = await getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    const email = await resolveRequestEmail();
    if (!isAdminEmail(email)) {
      if (!isOmRequestAuthor(existing, email)) {
        return NextResponse.json({ error: "본인이 작성한 요청만 삭제할 수 있습니다." }, { status: 403 });
      }
      if (existing.status === "배정완료") {
        return NextResponse.json({ error: "OM 지정 완료된 요청은 관리자만 삭제할 수 있습니다." }, { status: 403 });
      }
    }

    const ok = await deleteOmRequest(id);
    if (!ok) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}

export const PATCH = withActivity("/api/om-request/[id]", "PATCH", activityPATCH, runOmRequestWriteRequest);

export const DELETE = withActivity("/api/om-request/[id]", "DELETE", activityDELETE, runOmRequestWriteRequest);
