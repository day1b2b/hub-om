import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

export async function requireAdminSession() {
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !isAllowedWorkspaceEmail(email) || !isAdminEmail(email)) {
    redirect("/dashboard");
  }

  return session;
}

export function getAdminAccessMode() {
  return getConfiguredAdminEmails().length > 0 ? "ADMIN_EMAILS" : "workspace";
}

function isAdminEmail(email: string) {
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
