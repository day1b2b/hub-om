export const ALLOWED_WORKSPACE_DOMAIN = "day1company.co.kr";

export function isAllowedWorkspaceEmail(email?: string | null) {
  if (!email) return false;

  return email.toLowerCase().endsWith(`@${ALLOWED_WORKSPACE_DOMAIN}`);
}
