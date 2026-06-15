import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { ALLOWED_WORKSPACE_DOMAIN, isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

interface SignInPageProps {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const redirectTo = safeRedirectPath(params.callbackUrl);

  if (session?.user?.email && isAllowedWorkspaceEmail(session.user.email)) {
    redirect(redirectTo);
  }

  const errorMessage = getErrorMessage(params.error);

  return (
    <main className="sign-in-shell">
      <section className="sign-in-panel" aria-labelledby="sign-in-title">
        <div className="brand sign-in-brand">
          <span className="brand-mark">OD</span>
          <div>
            <strong>hub-om</strong>
            <span>OM 운영 현황 관리 시스템</span>
          </div>
        </div>
        <div>
          <p className="eyebrow">Google Workspace SSO</p>
          <h1 id="sign-in-title">회사 계정으로 로그인</h1>
          <p className="lede">
            {ALLOWED_WORKSPACE_DOMAIN} Google Workspace 계정만 hub-om에 접근할 수 있습니다.
          </p>
        </div>
        {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
        >
          <button className="primary-action" type="submit">
            Google로 계속하기
          </button>
        </form>
      </section>
    </main>
  );
}

function safeRedirectPath(callbackUrl?: string) {
  if (!callbackUrl) return "/";

  if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
    return callbackUrl;
  }

  try {
    const parsedUrl = new URL(callbackUrl);
    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}` || "/";
  } catch {
    return "/";
  }
}

function getErrorMessage(error?: string) {
  if (!error) return null;
  if (error === "AccessDenied") return "허용된 회사 Google 계정이 아닙니다.";

  return "로그인 중 문제가 발생했습니다. 다시 시도해 주세요.";
}
