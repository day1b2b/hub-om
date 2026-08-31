import { NextResponse } from "next/server";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";

/**
 * 팀 멤버 이메일 → 이름 조회 (서버 간 호출용, 읽기 전용)
 *
 * 왜 있나:
 *   만족도 분석 앱은 [시트 반영] 때 운영매니저 이름을 함께 기록한다. 그 이름을 사람이
 *   직접 입력하다 보니 "이유진"·"이유진C"처럼 갈려서 같은 사람이 여러 명으로 집계됐다.
 *   이메일은 하나이므로, hub-om 멤버 목록을 원본으로 두고 이름을 여기서 받아 간다.
 *   그러지 않으면 이메일↔이름 표를 스크립트 속성에 손으로 관리해야 한다.
 *
 * 인증:
 *   세션이 아니라 공유 토큰(`COURSE_LOOKUP_TOKEN`)으로 자체 인증한다 — api/sales/lookup 과
 *   같은 방식이고, 같은 이유로 `src/proxy.ts` 매처에서 제외해야 한다.
 *   토큰이 설정되지 않았으면 503으로 "꺼져 있음"을 알린다.
 *
 * 내보내는 값:
 *   ★ 이름과 이메일만. 슬랙 ID·팀·권한은 이 용도에 필요 없어서 담지 않는다.
 */
export const dynamic = "force-dynamic";

/** 요청에서 공유 토큰을 꺼낸다: `Authorization: Bearer` → `x-lookup-token` → `?token=` 순. */
function readRequestToken(request: Request, url: URL): string {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  return bearer || (request.headers.get("x-lookup-token") ?? "").trim() || (url.searchParams.get("token") ?? "").trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const expectedToken = process.env.COURSE_LOOKUP_TOKEN?.trim() ?? "";
  if (!expectedToken) {
    return NextResponse.json(
      { ok: false, configured: false, error: "멤버 조회가 설정되지 않았습니다(COURSE_LOOKUP_TOKEN)." },
      { status: 503 }
    );
  }

  const providedToken = readRequestToken(request, url);
  if (providedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "인증 토큰이 올바르지 않습니다." }, { status: 401 });
  }

  try {
    const users = await listTeamUsers();
    const members = users
      .map((user) => ({
        email: (user.email ?? "").trim().toLowerCase(),
        name: (user.name ?? "").trim()
      }))
      .filter((member) => member.email !== "" && member.name !== "");

    return NextResponse.json({ ok: true, count: members.length, members });
  } catch {
    return NextResponse.json({ ok: false, error: "멤버 목록을 읽지 못했습니다." }, { status: 500 });
  }
}
