import { NextResponse } from "next/server";
import { deleteTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";

export async function POST(request: Request) {
  try {
    const { ids } = (await request.json()) as { ids: string[] };
    if (!ids?.length) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    const count = await deleteTeamUsers(ids);
    return NextResponse.json({ deleted: count });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
