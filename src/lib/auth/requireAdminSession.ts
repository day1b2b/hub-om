import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

/**
 * 페이지용 admin 가드. 비-admin이면 /dashboard로 redirect한다.
 */
export async function requireAdminSession() {
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

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;

  const configuredEmails = getConfiguredAdminEmails();
  if (configuredEmails.length === 0) return true;

  return configuredEmails.includes(email.toLowerCase());
}

function getConfiguredAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
