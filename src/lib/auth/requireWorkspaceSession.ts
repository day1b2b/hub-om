import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

export async function requireWorkspaceSession() {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    const email = process.env.DEV_AUTH_EMAIL ?? "dev@day1company.co.kr";
    return { user: { email, name: "Dev User", image: null }, expires: "" } as any;
  }

  const session = await auth();

  if (!session?.user?.email || !isAllowedWorkspaceEmail(session.user.email)) {
    redirect("/sign-in");
  }

  return session;
}
