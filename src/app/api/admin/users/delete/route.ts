import { NextResponse } from "next/server";
// 명단은 남의 대시보드를 바꾸는 권한의 뿌리다. 로그인만으로는 부족하다.
import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { deleteTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";

export async function POST(request: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;

  try {
    const { ids } = (await request.json()) as { ids: string[] };
    if (!ids?.length) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    const count = await deleteTeamUsers(ids);
    return NextResponse.json({ deleted: count });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
