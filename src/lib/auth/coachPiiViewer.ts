import { isAllowedWorkspaceEmail } from "./workspaceAccess";

/**
 * ADMIN_EMAILS env를 파싱한다(소문자, 공백 제거, 빈 값 제외).
 */
export function getConfiguredAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 코치 민감정보(PII) 열람 가능 여부. **fail-closed**.
 *
 * 일반 admin 판별(isAdminEmail)은 ADMIN_EMAILS 미설정 시 워크스페이스 전체를
 * admin으로 간주한다(fail-open). PII는 그 위험을 허용하면 안 되므로,
 * ADMIN_EMAILS가 명시적으로 설정되고 그 목록에 포함된 워크스페이스 계정에게만 허용한다.
 * ADMIN_EMAILS가 비어 있으면 아무에게도 허용하지 않는다.
 *
 * auth()에 의존하지 않는 순수 함수라 단위 테스트가 가능하다.
 */
export function isCoachPiiViewer(email?: string | null): boolean {
  if (!email || !isAllowedWorkspaceEmail(email)) return false;

  const configuredEmails = getConfiguredAdminEmails();
  if (configuredEmails.length === 0) return false; // fail-closed

  return configuredEmails.includes(email.toLowerCase());
}
