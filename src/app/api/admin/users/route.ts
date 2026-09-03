import { NextResponse } from "next/server";
// 명단은 남의 대시보드를 바꾸는 권한의 뿌리다. 로그인만으로는 부족하다.
import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { createTeamUser, DuplicateTeamUserEmailError, listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUserInput } from "@/lib/data/teamUsers/teamUserTypes";

export async function GET() {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;

  return NextResponse.json(await listTeamUsers());
}

export async function POST(request: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;

  try {
    const body = await request.json();

    if (Array.isArray(body)) {
      const inputs = body as TeamUserInput[];
      if (inputs.some((input) => !input.name || !input.email)) {
        return NextResponse.json({ error: "이름과 이메일은 필수입니다" }, { status: 400 });
      }
      // 한 건씩 순서대로 만든다. Promise.all로 동시에 만들면 같은 이메일이 두 건 들어 있을 때
      // 서로의 중복 검사를 통과해 둘 다 저장된다.
      const created = [];
      for (const input of inputs) {
        created.push(await createTeamUser(input));
      }
      return NextResponse.json(created, { status: 201 });
    }

    const input = body as TeamUserInput;
    if (!input.name || !input.email) {
      return NextResponse.json({ error: "이름과 이메일은 필수입니다" }, { status: 400 });
    }
    const created = await createTeamUser(input);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // 중복 이메일은 사용자가 고칠 수 있는 문제다. "저장 실패"로 뭉개면 원인을 알 수 없다.
    if (error instanceof DuplicateTeamUserEmailError) {
      const names = error.existingNames.join(", ");
      return NextResponse.json(
        { error: `이미 명단에 있는 이메일입니다. 등록된 이름: ${names} — 새로 만들지 말고 그 행의 이름을 고쳐 주세요.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
