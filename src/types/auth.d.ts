import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    gmailReadGranted?: boolean;
    googleAccessToken?: string;
    googleTokenError?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    gmailReadGranted?: boolean;
    googleAccessToken?: string;
    googleAccessTokenExpiresAt?: number;
    googleRefreshToken?: string;
    googleTokenError?: string;
  }
}
