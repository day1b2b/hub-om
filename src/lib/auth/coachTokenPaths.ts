// 코치 본인 일정 입력 경로. 코치는 직원 Google 계정이 없으므로 세션 대신
// 개인 링크의 토큰(validateCoachToken)으로 각 핸들러가 직접 인증한다.
// /coaches(직원용 코치 관리)와 헷갈리지 않도록 정확한 경로만 허용한다.
const COACH_TOKEN_PATHS = new Set(["/coach", "/api/coach/me"]);
const COACH_SCHEDULE_PATH = /^\/api\/coach\/schedule\/[^/]+$/;

export function isCoachTokenPath(pathname: string): boolean {
  return COACH_TOKEN_PATHS.has(pathname) || COACH_SCHEDULE_PATH.test(pathname);
}
