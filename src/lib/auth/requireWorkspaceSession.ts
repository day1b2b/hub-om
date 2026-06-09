import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

export async function requireWorkspaceSession() {
  const session = await auth();

  if (!session?.user?.email || !isAllowedWorkspaceEmail(session.user.email)) {
    redirect("/sign-in");
  }

  return session;
}
