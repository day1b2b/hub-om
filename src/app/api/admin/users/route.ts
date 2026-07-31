import { NextResponse } from "next/server";
import { createTeamUser, listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUserInput } from "@/lib/data/teamUsers/teamUserTypes";

export async function GET() {
  return NextResponse.json(await listTeamUsers());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (Array.isArray(body)) {
      const inputs = body as TeamUserInput[];
      if (inputs.some((input) => !input.name || !input.email)) {
        return NextResponse.json({ error: "이름과 이메일은 필수입니다" }, { status: 400 });
      }
      const created = await Promise.all(inputs.map((input) => createTeamUser(input)));
      return NextResponse.json(created, { status: 201 });
    }

    const input = body as TeamUserInput;
    if (!input.name || !input.email) {
      return NextResponse.json({ error: "이름과 이메일은 필수입니다" }, { status: 400 });
    }
    const created = await createTeamUser(input);
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
