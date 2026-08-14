import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOmRequest, updateOmRequestAssignment } from "@/lib/data/omRequest/omRequestLocalRepository";
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

    const existing = getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    const currentUser = await resolveCurrentUser();
    if (!canManageOmRequestAssignment(existing.team, currentUser.name, currentUser.email)) {
      return NextResponse.json({ error: "이 파트의 담당 관리자만 지정할 수 있습니다." }, { status: 403 });
    }

    const updated = updateOmRequestAssignment(id, assignedOm);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    if (assignedOm) {
      // 요청 접수 알림 스레드에 댓글로 OM·LD를 태깅한다(스레드 정보가 있을 때).
      await notifyOmAssigned({
        company: updated.company,
        courseName: updated.courseName,
        assignedOm,
        ld: updated.ld,
        ldEmail: updated.ldEmail,
        channel: updated.slackChannel,
        threadTs: updated.slackThreadTs,
      });
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
