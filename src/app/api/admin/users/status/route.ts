import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
// 명단은 남의 대시보드를 바꾸는 권한의 뿌리다. 로그인만으로는 부족하다.
import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { updateTeamUsersStatus } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUserStatus } from "@/lib/data/teamUsers/teamUserTypes";
import { runUserAdminRequest } from "@/lib/data/userAdminComposition";

const VALID_STATUSES: TeamUserStatus[] = ["active", "departed"];

async function activityPOST(request: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;

  try {
    const body = await request.json();
    const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string") : [];
    const status = body?.status as TeamUserStatus;

    if (ids.length === 0) {
      return NextResponse.json({ error: "선택된 사용자가 없습니다" }, { status: 400 });
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "상태 값이 올바르지 않습니다" }, { status: 400 });
    }

    const count = await updateTeamUsersStatus(ids, status);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

export const POST = withActivity("/api/admin/users/status", "POST", activityPOST, runUserAdminRequest);
