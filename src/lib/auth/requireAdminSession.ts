import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { getConfiguredAdminEmails, isCoachPiiViewer } from "@/lib/auth/coachPiiViewer";

export { isCoachPiiViewer } from "@/lib/auth/coachPiiViewer";

/**
 * 페이지용 admin 가드. 비-admin이면 /dashboard로 redirect한다.
 */
export async function requireAdminSession() {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    const email = process.env.DEV_AUTH_EMAIL ?? "dev@day1company.co.kr";

    if (!isAdminEmail(email)) {
      redirect("/dashboard");
    }

    return { user: { email, name: "Dev User", image: null }, expires: "" } as Session;
  }

  const session = await auth();
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
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    const email = process.env.DEV_AUTH_EMAIL ?? "dev@day1company.co.kr";

    if (!isAdminEmail(email)) {
      throw new Error("admin 권한이 필요합니다.");
    }

    return { user: { email, name: "Dev User", image: null }, expires: "" } as Session;
  }

  const session = await auth();
  const email = session?.user?.email;

  if (!session || !email || !isAllowedWorkspaceEmail(email) || !isAdminEmail(email)) {
    throw new Error("admin 권한이 필요합니다.");
  }

  return session;
}

export function getAdminAccessMode() {
  return getConfiguredAdminEmails().length > 0 ? "ADMIN_EMAILS" : "unconfigured";
}

/**
 * 현재 세션(또는 로컬 개발용 DEV_AUTH_BYPASS)의 관리자 여부.
 * 사이드바 등 클라이언트 컴포넌트에 role을 내려주기 위한 서버 전용 헬퍼.
 */
export async function resolveSessionIsAdmin(): Promise<boolean> {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return isAdminEmail(process.env.DEV_AUTH_EMAIL ?? "dev@day1company.co.kr");
  }

  const session = await auth();
  return isAdminEmail(session?.user?.email);
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
 * 일반 admin 판별. **fail-closed**: ADMIN_EMAILS가 비어있으면 아무도 admin이 아니다.
 * (일반/관리자 메뉴 분리 도입 전에는 ADMIN_EMAILS 미설정 시 fail-open이었으나,
 * 역할 분리가 실제로 의미를 가지려면 미설정 상태의 안전한 기본값은 "전원 admin"이 아니라 "전원 일반"이어야 한다.)
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;

  const configuredEmails = getConfiguredAdminEmails();
  if (configuredEmails.length === 0) return false;

  return configuredEmails.includes(email.toLowerCase());
}
