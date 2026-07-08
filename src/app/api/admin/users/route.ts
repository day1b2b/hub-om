import { NextResponse } from "next/server";
import { createTeamUser, listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUserInput } from "@/lib/data/teamUsers/teamUserTypes";

export async function GET() {
  return NextResponse.json(listTeamUsers());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TeamUserInput;
    if (!body.name || !body.email) {
      return NextResponse.json({ error: "이름과 이메일은 필수입니다" }, { status: 400 });
    }
    const created = createTeamUser(body);
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
