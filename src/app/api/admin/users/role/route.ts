import { NextResponse } from "next/server";
import { updateTeamUsersRole } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUserRole } from "@/lib/data/teamUsers/teamUserTypes";

const VALID_ROLES: TeamUserRole[] = ["ld", "om"];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string") : [];
    const role = body?.role as TeamUserRole;

    if (ids.length === 0) {
      return NextResponse.json({ error: "선택된 사용자가 없습니다" }, { status: 400 });
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "구분 값이 올바르지 않습니다" }, { status: 400 });
    }

    const count = await updateTeamUsersRole(ids, role);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
