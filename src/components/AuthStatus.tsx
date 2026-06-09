import { auth, signOut } from "@/auth";

export async function AuthStatus() {
  const session = await auth();

  if (!session?.user?.email) return null;

  return (
    <aside className="auth-status-panel" aria-label="로그인 상태">
      <div>
        <span>로그인</span>
        <strong>{session.user.name || session.user.email}</strong>
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
