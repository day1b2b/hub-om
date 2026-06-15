import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ALLOWED_WORKSPACE_DOMAIN, isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";

const DEV_AUTH_SECRET = "hub-om-local-development-auth-secret";

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
          hd: ALLOWED_WORKSPACE_DOMAIN,
          prompt: "select_account"
        }
      }
    })
  ],
  callbacks: {
    authorized({ auth: session, request }) {
      const { pathname } = request.nextUrl;
      const isSignedIn = Boolean(session?.user?.email && isAllowedWorkspaceEmail(session.user.email));

      if (pathname.startsWith("/sign-in")) {
        return true;
      }

      return isSignedIn;
    },
    signIn({ profile, user }) {
      const email = profile?.email ?? user.email;
      const hostedDomain = getHostedDomain(profile);
      const hostedDomainAllowed = !hostedDomain || hostedDomain === ALLOWED_WORKSPACE_DOMAIN;

      return isAllowedWorkspaceEmail(email) && hostedDomainAllowed;
    }
  }
});
