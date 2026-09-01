import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    googleAccessToken?: string;
    googleSheetsReadGranted?: boolean;
    googleTokenError?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    googleAccessToken?: string;
    googleAccessTokenExpiresAt?: number;
    googleRefreshToken?: string;
    googleSheetsReadGranted?: boolean;
    googleTokenError?: string;
  }
}
