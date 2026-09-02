import { NextResponse } from "next/server";
import { assertAdminSession } from "./requireAdminSession";

/**
 * API 라우트용 admin 게이트. 권한이 없으면 403 응답을, 있으면 null을 돌려준다.
 *
 * assertAdminSession은 예외를 던진다. 라우트 본문의 try/catch 안에서 부르면 그 catch가
 * 삼켜서 "저장 실패" 500이 되고, 권한 문제인지 서버 오류인지 구분되지 않는다.
 * 그래서 try 밖에서 이 함수를 부르고 돌려받은 응답을 그대로 반환하는 방식으로 쓴다.
 */
export async function denyIfNotAdmin(): Promise<NextResponse | null> {
  try {
    await assertAdminSession();
    return null;
  } catch {
    return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
  }
}
