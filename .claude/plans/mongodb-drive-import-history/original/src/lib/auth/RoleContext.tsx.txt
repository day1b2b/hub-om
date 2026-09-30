"use client";

import { createContext, useContext, type ReactNode } from "react";

const IsAdminContext = createContext(false);
const SatisfactionMatchingAccessContext = createContext(false);

export function RoleProvider({
  isAdmin,
  satisfactionMatchingEnabled = false,
  children
}: {
  isAdmin: boolean;
  satisfactionMatchingEnabled?: boolean;
  children: ReactNode;
}) {
  return (
    <IsAdminContext.Provider value={isAdmin}>
      <SatisfactionMatchingAccessContext.Provider value={isAdmin && satisfactionMatchingEnabled}>
        {children}
      </SatisfactionMatchingAccessContext.Provider>
    </IsAdminContext.Provider>
  );
}

/**
 * 현재 로그인 사용자가 관리자인지 여부. RootLayout에서 서버 세션 기준으로 계산해 내려준 값이다.
 */
export function useIsAdmin() {
  return useContext(IsAdminContext);
}

/** 메뉴 표시용. 실제 접근 통제는 페이지와 API에서도 서버 측으로 수행한다. */
export function useCanAccessSatisfactionMatching() {
  return useContext(SatisfactionMatchingAccessContext);
}
