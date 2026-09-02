import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { resolveSessionIsAdmin } from "@/lib/auth/requireAdminSession";
import { isSatisfactionMatchingEnabled } from "@/lib/auth/satisfactionMatchingAccess";
import "./globals.css";

export const metadata: Metadata = {
  title: "hub-om",
  description: "OM 운영 현황을 관리하는 hub-om"
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const isAdmin = await resolveSessionIsAdmin();

  return (
    <html lang="ko">
      <body>
        <Providers isAdmin={isAdmin} satisfactionMatchingEnabled={isSatisfactionMatchingEnabled()}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
