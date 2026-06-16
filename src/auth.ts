import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { ALLOWED_WORKSPACE_DOMAIN, isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBLIC_PATHS = new Set([
  "/",
  "/sign-in",
  "/privacy",
  "/terms",
  "/hub-om-logo.svg",
  "/hub-om-logo-120.png"
]);

function getHostedDomain(profile: unknown) {
  if (!profile || typeof profile !== "object" || !("hd" in profile)) return null;

  const hostedDomain = (profile as { hd?: unknown }).hd;
  return typeof hostedDomain === "string" ? hostedDomain : null;
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  pages: {
    error: "/sign-in",
    signIn: "/sign-in"
  },
  providers: [
    Google({
      authorization: {
        params: {
          access_type: "offline",
          hd: ALLOWED_WORKSPACE_DOMAIN,
          include_granted_scopes: "true",
          prompt: "consent select_account",
          response_type: "code",
          scope: [
            "openid",
            "email",
            "profile",
            GMAIL_READONLY_SCOPE
          ].join(" ")
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
        token.gmailReadGranted = hasGrantedScope(account.scope, GMAIL_READONLY_SCOPE);
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
        token.gmailReadGranted = false;
        token.googleTokenError = "missing_refresh_token";
        return token;
      }

      return refreshGoogleAccessToken(token);
    },
    session({ session, token }) {
      session.googleAccessToken = typeof token.googleAccessToken === "string" ? token.googleAccessToken : undefined;
      session.gmailReadGranted = token.gmailReadGranted === true;
      session.googleTokenError = typeof token.googleTokenError === "string" ? token.googleTokenError : undefined;
      return session;
    }
  }
});

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
      gmailReadGranted: false,
      googleTokenError: "refresh_failed"
    };
  }

  return {
    ...token,
    googleAccessToken: payload.access_token,
    googleAccessTokenExpiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    gmailReadGranted: payload.scope ? hasGrantedScope(payload.scope, GMAIL_READONLY_SCOPE) : token.gmailReadGranted === true,
    googleTokenError: undefined
  };
}
