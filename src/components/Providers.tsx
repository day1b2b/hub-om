"use client";

import { BrowserDraftProvider } from "./BrowserDraftProvider";
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
      <BrowserDraftProvider>
      <RoleProvider isAdmin={isAdmin} satisfactionMatchingEnabled={satisfactionMatchingEnabled}>
        {children}
      </RoleProvider>
      </BrowserDraftProvider>
    </SessionProvider>
  );
}
