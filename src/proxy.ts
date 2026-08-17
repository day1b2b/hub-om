export { auth as proxy } from "@/auth";

export const config = {
  // api/sales/lookup은 세션이 아니라 공유 토큰(COURSE_LOOKUP_TOKEN)으로 자체 인증하므로,
  // 외부 로컬 도구(survey_analysis)가 세션 없이 호출할 수 있게 세션 미들웨어에서 제외한다.
  matcher: ["/((?!api/auth|api/health|api/sales/lookup|_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
