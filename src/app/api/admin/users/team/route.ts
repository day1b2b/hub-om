import { NextResponse } from "next/server";
import { updateTeamUserTeam } from "@/lib/data/teamUsers/teamUserRepository";
import { TEAM_OPTIONS } from "@/lib/data/teamUsers/teamUserTypes";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const id = typeof body?.id === "string" ? body.id : "";
    const rawTeam = body?.team;
    const team = typeof rawTeam === "string" ? rawTeam.trim() : "";

    if (!id) {
      return NextResponse.json({ error: "사용자를 선택해주세요" }, { status: 400 });
    }
    if (team && !TEAM_OPTIONS.includes(team as (typeof TEAM_OPTIONS)[number])) {
      return NextResponse.json({ error: "팀 값이 올바르지 않습니다" }, { status: 400 });
    }

    const updated = await updateTeamUserTeam(id, team || null);
    if (!updated) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
