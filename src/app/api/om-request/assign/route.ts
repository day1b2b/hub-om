import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAssignedOmToLinkedOperation } from "@/lib/data/omRequest/omRequestOperationLink";
import { getOmRequestRepository } from "@/lib/data/omRequest/omRequestRepositoryFactory";
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

    const omRequestRepository = getOmRequestRepository();
    const existing = await omRequestRepository.getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    const currentUser = await resolveCurrentUser();
    if (!canManageOmRequestAssignment(existing.team, currentUser.name, currentUser.email)) {
      return NextResponse.json({ error: "이 파트의 담당 관리자만 지정할 수 있습니다." }, { status: 403 });
    }

    const updated = await omRequestRepository.updateOmRequestAssignment(id, assignedOm);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    if (assignedOm && updated.operationId) {
      try {
        await syncAssignedOmToLinkedOperation(updated.operationId, assignedOm);
      } catch (syncError) {
        console.error("배정된 OM을 운영현황에 동기화하지 못함", syncError);
      }
    }

    if (assignedOm) {
      await notifyOmAssigned({
        company: updated.company,
        courseName: updated.courseName,
        assignedOm,
      });
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
