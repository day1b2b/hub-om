import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOmRequest, updateOmRequestAssignment } from "@/lib/data/omRequest/omRequestLocalRepository";
import { omRequestManagerName } from "@/lib/data/omRequest/omRequestTypes";
import { notifyOmAssigned } from "@/lib/slack/notifySlack";

async function resolveCurrentUserName(): Promise<string> {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return "Dev User";
  }
  const session = await auth();
  return session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "";
}

export async function PATCH(request: Request) {
  try {
    const { id, assignedOm } = (await request.json()) as { id: string; assignedOm: string | null };
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

    const existing = getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    const managerName = omRequestManagerName(existing.team);
    if (managerName) {
      const currentUserName = await resolveCurrentUserName();
      if (currentUserName.trim() !== managerName.trim()) {
        return NextResponse.json({ error: "이 파트의 담당 관리자만 지정할 수 있습니다." }, { status: 403 });
      }
    }

    const updated = updateOmRequestAssignment(id, assignedOm);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
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
