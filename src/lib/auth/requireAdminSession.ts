import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { getConfiguredAdminEmails, isCoachPiiViewer } from "@/lib/auth/coachPiiViewer";

export { isCoachPiiViewer } from "@/lib/auth/coachPiiViewer";

function getDevBypassSession(): Session | null {
  if (process.env.DEV_AUTH_BYPASS !== "true" || process.env.NODE_ENV === "production") {
    return null;
  }

  const email = process.env.DEV_AUTH_EMAIL ?? "dev@day1company.co.kr";
  return { user: { email, name: "Dev User", image: null }, expires: "" } as Session;
}

/**
 * 페이지용 admin 가드. 비-admin이면 /dashboard로 redirect한다.
 */
export async function requireAdminSession() {
  const session = getDevBypassSession() ?? (await auth());
  const email = session?.user?.email;

  if (!email || !isAllowedWorkspaceEmail(email) || !isAdminEmail(email)) {
    redirect("/dashboard");
  }

  return session;
}

/**
 * API/서비스용 admin 단언. 비-admin이면 redirect 대신 throw한다.
 * 페이지가 아닌 곳(데이터 서비스 등)에서 권한을 강제할 때 쓴다.
 */
export async function assertAdminSession(): Promise<Session> {
  const session = await auth();
  const email = session?.user?.email;

  if (!session || !email || !isAllowedWorkspaceEmail(email) || !isAdminEmail(email)) {
    throw new Error("admin 권한이 필요합니다.");
  }

  return session;
}

export function getAdminAccessMode() {
  return getConfiguredAdminEmails().length > 0 ? "ADMIN_EMAILS" : "workspace";
}

/**
 * 코치 민감정보 서비스용 단언. fail-closed. 권한 없으면 throw.
 * 판별 로직은 @/lib/auth/coachPiiViewer의 isCoachPiiViewer(순수 함수)에 위임한다.
 */
export async function assertCoachPiiAccess(): Promise<Session> {
  const session = await auth();
  const email = session?.user?.email;

  if (!session || !isCoachPiiViewer(email)) {
    throw new Error("코치 개인정보 열람 권한이 없습니다. (ADMIN_EMAILS 설정 및 admin 계정 필요)");
  }

  return session;
}

/**
 * 일반 admin 판별. ADMIN_EMAILS 미설정 시 워크스페이스 전체를 admin으로 간주(fail-open).
 * 기존 hub-om admin 페이지의 동작이며, PII에는 이 함수를 쓰지 말고 isCoachPiiViewer를 쓴다.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;

  const configuredEmails = getConfiguredAdminEmails();
  if (configuredEmails.length === 0) return true;

  return configuredEmails.includes(email.toLowerCase());
}
