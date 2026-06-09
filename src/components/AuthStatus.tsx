import { auth, signOut } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

export async function AuthStatus() {
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !isAllowedWorkspaceEmail(email)) return null;

  const displayName = session?.user?.name || email;

  return (
    <aside className="auth-status-panel" aria-label="로그인 상태">
      <div>
        <span>로그인</span>
        <strong>{displayName}</strong>
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/sign-in" });
        }}
      >
        <button type="submit">로그아웃</button>
      </form>
    </aside>
  );
}
