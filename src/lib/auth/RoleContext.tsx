"use client";

import { createContext, useContext, type ReactNode } from "react";

const IsAdminContext = createContext(false);

export function RoleProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  return <IsAdminContext.Provider value={isAdmin}>{children}</IsAdminContext.Provider>;
}

/**
 * 현재 로그인 사용자가 관리자인지 여부. RootLayout에서 서버 세션 기준으로 계산해 내려준 값이다.
 */
export function useIsAdmin() {
  return useContext(IsAdminContext);
}
