import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server.js";
import { auth } from "@/auth";
import { getOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import { assignOmRequestAtomically, previewOmAssignment, OmAssignmentConflict } from "@/lib/data/omRequest/omRequestAssignment";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { reflectOperationUpdated } from "@/lib/googleCalendar/reflectOperationToCalendar";
import { canManageOmRequestAssignment } from "@/lib/auth/omRequestAssignmentAccess";
import { notifyOmAssigned } from "@/lib/slack/notifySlack";

async function resolveCurrentUser(): Promise<{ name: string; email?: string | null }> {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return { name: "Dev User", email: process.env.DEV_AUTH_EMAIL };
  }
  const session = await auth();
  return {
    name: session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "",
    email: session?.user?.email
  };
}

const noStore = { "Cache-Control": "no-store" };

async function assignment(request: Request, preview: boolean) {
  try {
    const currentUser = await resolveCurrentUser();
    if (!currentUser.email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401, headers: noStore });
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "입력값을 확인해주세요." }, { status: 400, headers: noStore });
    const { id, assignedOm, confirmationToken } = body as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || id.length > 200 ||
      (assignedOm !== null && (typeof assignedOm !== "string" || !assignedOm.trim() || assignedOm.length > 200))) {
      return NextResponse.json({ error: "요청과 담당자를 확인해주세요." }, { status: 400, headers: noStore });
    }

    const existing = await getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404, headers: noStore });

    if (!await canManageOmRequestAssignment(existing.team, currentUser.email)) {
      return NextResponse.json({ error: "이 파트의 담당 관리자만 지정할 수 있습니다." }, { status: 403, headers: noStore });
    }

    // 배정이 실제로 바뀔 때만 알림한다. 같은 OM으로 재저장(중복 클릭 등) 시에는
    // 스레드에 같은 댓글이 여러 번 달리지 않도록 이전 값과 비교한다.
    const prevOm = existing.assignedOm?.trim() || null;
    const nextOm = assignedOm?.trim() || null;
    const assignmentChanged = prevOm !== nextOm;

    if (preview) {
      return NextResponse.json({ preview: await previewOmAssignment(existing, nextOm, currentUser.email) }, { headers: noStore });
    }
    if (typeof confirmationToken !== "string" || !confirmationToken || confirmationToken.length > 512) {
      return NextResponse.json({ error: "변경할 회차를 다시 확인해주세요." }, { status: 409, headers: noStore });
    }
    const { updated, operationIds } = await assignOmRequestAtomically(existing, nextOm, currentUser.email, confirmationToken);
    // Reflect only committed changes; external calendar failures do not undo DB assignments.
    for (const operationId of operationIds) {
      try {
        const operation = await getOperationRepository().getOperationById(operationId);
        if (operation) await reflectOperationUpdated(operation);
      } catch {
        console.error("[om-request] 배정 저장 후 캘린더 반영 실패");
      }
    }
    if (nextOm && assignmentChanged) {
      // 요청 접수 알림 스레드에 댓글로 OM·LD를 태깅한다(스레드 정보가 있을 때).
      // Slack 알림 실패가 배정 저장까지 되돌리지 않도록 방어적으로 처리한다.
      try {
        await notifyOmAssigned({
          company: updated.company,
          courseName: updated.courseName,
          assignedOm: nextOm,
          ld: updated.ld,
          ldEmail: updated.ldEmail,
          channel: updated.slackChannel,
          threadTs: updated.slackThreadTs,
        });
      } catch (err) {
        console.error("[om-request] Slack 배정 알림 실패(무시):", err);
      }
    }
    return NextResponse.json(updated, { headers: noStore });
  } catch (err) {
    if (err instanceof OmAssignmentConflict) return NextResponse.json({ error: err.message }, { status: 409, headers: noStore });
    console.error("[om-request] 배정 확인 또는 저장 실패");
    return NextResponse.json({ error: "배정을 처리하지 못했습니다. 잠시 후 다시 확인해주세요." }, { status: 500, headers: noStore });
  }
}

// Preview contains names, so it must not put the selected assignee in a URL or cache.
export const POST = withActivity("/api/om-request/assign", "POST", (request: Request) => assignment(request, true));
export const PATCH = withActivity("/api/om-request/assign", "PATCH", (request: Request) => assignment(request, false));
