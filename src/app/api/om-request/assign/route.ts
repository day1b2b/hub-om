import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOmRequest, updateOmRequestAssignment } from "@/lib/data/omRequest/omRequestLocalRepository";
import { syncAssignedOmToLinkedOperation } from "@/lib/data/omRequest/omRequestOperationLink";
import { canManageOmRequestAssignment } from "@/lib/data/omRequest/omRequestTypes";
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

export async function PATCH(request: Request) {
  try {
    const { id, assignedOm } = (await request.json()) as { id: string; assignedOm: string | null };
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

    const existing = await getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    const currentUser = await resolveCurrentUser();
    if (!canManageOmRequestAssignment(existing.team, currentUser.name, currentUser.email)) {
      return NextResponse.json({ error: "이 파트의 담당 관리자만 지정할 수 있습니다." }, { status: 403 });
    }

    // 배정이 실제로 바뀔 때만 알림한다. 같은 OM으로 재저장(중복 클릭 등) 시에는
    // 스레드에 같은 댓글이 여러 번 달리지 않도록 이전 값과 비교한다.
    const prevOm = existing.assignedOm?.trim() || null;
    const nextOm = assignedOm?.trim() || null;
    const assignmentChanged = prevOm !== nextOm;

    const updated = await updateOmRequestAssignment(id, assignedOm);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    if (nextOm && assignmentChanged && updated.operationId) {
      // 자동 연결된 운영현황 회차의 OM 값도 함께 맞춘다. 실패해도 배정 저장은 되돌리지 않는다.
      try {
        await syncAssignedOmToLinkedOperation(updated.operationId, nextOm);
      } catch (err) {
        console.error("[om-request] 운영현황 OM 동기화 실패(무시):", err);
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
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[om-request] 배정 저장 실패:", err);
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
