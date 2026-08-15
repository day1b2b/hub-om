"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { RoleProvider } from "@/lib/auth/RoleContext";

export function Providers({ children, isAdmin }: { children: ReactNode; isAdmin: boolean }) {
  return (
    <SessionProvider>
      <RoleProvider isAdmin={isAdmin}>{children}</RoleProvider>
    </SessionProvider>
  );
}
