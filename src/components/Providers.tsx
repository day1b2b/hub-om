"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { RoleProvider } from "@/lib/auth/RoleContext";

export function Providers({
  children,
  isAdmin,
  satisfactionMatchingEnabled = false
}: {
  children: ReactNode;
  isAdmin: boolean;
  satisfactionMatchingEnabled?: boolean;
}) {
  return (
    <SessionProvider>
      <RoleProvider isAdmin={isAdmin} satisfactionMatchingEnabled={satisfactionMatchingEnabled}>
        {children}
      </RoleProvider>
    </SessionProvider>
  );
}
