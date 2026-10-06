export { auth as proxy } from "@/auth";

export const config = {
  // 아래 셋은 세션이 아니라 공유 토큰(COURSE_LOOKUP_TOKEN)으로 자체 인증하므로,
  // 외부 로컬 도구(survey_analysis)가 세션 없이 호출할 수 있게 세션 미들웨어에서 제외한다.
  //   api/sales/lookup            코스ID·고객사명 조회
  //   api/team-users/lookup       멤버 이메일→이름 조회
  //   api/satisfaction/round-apply 만족도 회차 단위 반영
  matcher: [
    "/((?!api/auth|api/health|api/sales/lookup|api/team-users/lookup|api/satisfaction/round-apply|_next/static|_next/image|favicon.ico|.*\\..*).*)"
  ]
};
