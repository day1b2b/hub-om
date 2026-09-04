import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { ALLOWED_WORKSPACE_DOMAIN, isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

const DEV_AUTH_SECRET = "hub-om-local-development-auth-secret";
const GOOGLE_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBLIC_PATHS = new Set([
  "/",
  "/sign-in",
  "/privacy",
  "/terms",
  "/hub-om-logo.svg",
  "/hub-om-logo-120.png"
]);

const SYNC_API_PATHS = new Set([
  "/api/admin/calendar/refresh-events",
  "/api/admin/sync-notion",
  "/api/reminders/lecture-followup",
  "/api/sync/calendar-events",
  "/api/sync/all",
  "/api/sync/engagements",
  "/api/sync/samsung-schedule"
]);

const BACKUP_API_PATHS = new Set(["/api/admin/backup"]);

function getHostedDomain(profile: unknown) {
  if (!profile || typeof profile !== "object" || !("hd" in profile)) return null;

  const hostedDomain = (profile as { hd?: unknown }).hd;
  return typeof hostedDomain === "string" ? hostedDomain : null;
}

function getAuthSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NEXTAUTH_SECRET) return process.env.NEXTAUTH_SECRET;
  if (process.env.NODE_ENV !== "production") return DEV_AUTH_SECRET;
  return undefined;
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  pages: {
    error: "/sign-in",
    signIn: "/sign-in"
  },
  secret: getAuthSecret(),
  providers: [
    Google({
      authorization: {
        params: {
          access_type: "offline",
          hd: ALLOWED_WORKSPACE_DOMAIN,
          // include_granted_scopes 는 넣지 않는다. 이 옵션은 "예전에 동의한 권한도 합쳐 달라"는
          // 뜻이라, 지메일·시트 권한을 줬던 사용자는 스코프를 아래처럼 줄여도 옛 민감 권한이
          // 동의 화면에 도로 끌려 나와 "확인되지 않은 앱" 경고가 계속 떴다(2026-09-03 실측:
          // 코드 변경 없이 myaccount.google.com 에서 hub-om 동의만 지우자 경고가 사라짐).
          // 단계적으로 권한을 늘리는 기능이 없어진 지금은 쓸 이유가 없다.
          prompt: "consent select_account",
          response_type: "code",
          // 민감 범위를 하나도 요구하지 않는다 — 미인증 앱이 민감 범위를 요구하면
          // Google이 로그인마다 "확인되지 않은 앱" 경고를 띄우기 때문이다.
          //
          // spreadsheets.readonly 는 '구글 시트 링크로 가져오기'(be33658)가 쓰던 것인데,
          // 그 화면은 a2397b7("엑셀 일괄 등록으로 개편", 2026-08-07)에서 내려갔고
          // API 라우트(/api/admin/imports/google-sheets/*)만 되돌리기 쉽게 남아 있다.
          // 즉 아무도 못 쓰는 기능 때문에 전원이 민감 권한에 동의하던 상태였다.
          //
          // 되살릴 때: 이 배열에 GOOGLE_SHEETS_READONLY_SCOPE 를 다시 넣고 화면을 붙이면 된다.
          // (캘린더 쓰기는 이 로그인이 아니라 B2B 전용 계정 토큰 GOOGLE_CAL_OAUTH_* 를 쓴다.)
          scope: ["openid", "email", "profile"].join(" ")
        }
      }
    })
  ],
  callbacks: {
    authorized({ auth: session, request }) {
      const { pathname } = request.nextUrl;
      const isSignedIn = Boolean(session?.user?.email && isAllowedWorkspaceEmail(session.user.email));

      if (PUBLIC_PATHS.has(pathname)) {
        return true;
      }

      if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
        return true;
      }

      if (SYNC_API_PATHS.has(pathname) && isAuthorizedBearerRequest(request.headers, process.env.SYNC_API_SECRET)) {
        return true;
      }

      if (BACKUP_API_PATHS.has(pathname) && isAuthorizedBearerRequest(request.headers, process.env.BACKUP_API_SECRET)) {
        return true;
      }

      return isSignedIn;
    },
    signIn({ profile, user }) {
      const email = profile?.email ?? user.email;
      const hostedDomain = getHostedDomain(profile);
      const hostedDomainAllowed = !hostedDomain || hostedDomain === ALLOWED_WORKSPACE_DOMAIN;

      return isAllowedWorkspaceEmail(email) && hostedDomainAllowed;
    },
    async jwt({ account, token }) {
      if (account?.access_token) {
        token.googleAccessToken = account.access_token;
        token.googleRefreshToken = account.refresh_token ?? token.googleRefreshToken;
        token.googleAccessTokenExpiresAt = account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000;
        token.googleSheetsReadGranted = hasGrantedScope(account.scope, GOOGLE_SHEETS_READONLY_SCOPE);
        token.googleTokenError = undefined;
        return token;
      }

      if (
        typeof token.googleAccessTokenExpiresAt === "number" &&
        token.googleAccessTokenExpiresAt > Date.now() + 60 * 1000
      ) {
        return token;
      }

      if (typeof token.googleRefreshToken !== "string") {
        token.googleAccessToken = undefined;
        token.googleSheetsReadGranted = false;
        token.googleTokenError = "missing_refresh_token";
        return token;
      }

      return refreshGoogleAccessToken(token);
    },
    session({ session, token }) {
      session.googleAccessToken = typeof token.googleAccessToken === "string" ? token.googleAccessToken : undefined;
      session.googleSheetsReadGranted = token.googleSheetsReadGranted === true;
      session.googleTokenError = typeof token.googleTokenError === "string" ? token.googleTokenError : undefined;
      return session;
    }
  }
});

function isAuthorizedBearerRequest(headers: Headers, configuredSecret: string | undefined) {
  if (!configuredSecret) return false;
  return headers.get("authorization") === `Bearer ${configuredSecret}`;
}

function hasGrantedScope(scope: string | undefined, expectedScope: string) {
  return scope?.split(/\s+/).includes(expectedScope) ?? false;
}

async function refreshGoogleAccessToken(token: JWT): Promise<JWT> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: String(token.googleRefreshToken)
    })
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!response.ok || !payload.access_token) {
    return {
      ...token,
      googleAccessToken: undefined,
      googleSheetsReadGranted: false,
      googleTokenError: "refresh_failed"
    };
  }

  return {
    ...token,
    googleAccessToken: payload.access_token,
    googleAccessTokenExpiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    googleSheetsReadGranted: payload.scope
      ? hasGrantedScope(payload.scope, GOOGLE_SHEETS_READONLY_SCOPE)
      : token.googleSheetsReadGranted === true,
    googleTokenError: undefined
  };
}
