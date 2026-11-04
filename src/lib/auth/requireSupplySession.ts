import type { Session } from "next-auth";
import { assertAdminSession, requireAdminSession } from "@/lib/auth/requireAdminSession";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { SUPPLY_ADMIN_ONLY } from "@/lib/auth/supplyAccessPolicy";

/** 운영물품 관리(에그·마이크) 페이지용 가드. 관리자 전용 기간에는 비-admin을 /dashboard로 보낸다. */
export async function requireSupplyPageSession(): Promise<Session> {
  return SUPPLY_ADMIN_ONLY ? requireAdminSession() : requireWorkspaceSession();
}

/** 운영물품 관리 API용. 관리자 전용 기간에 비-admin이면 null을 돌려주고, 호출한 쪽이 403으로 응답한다. */
export async function requireSupplyApiSession(): Promise<Session | null> {
  if (!SUPPLY_ADMIN_ONLY) return requireWorkspaceSession();

  try {
    return await assertAdminSession();
  } catch {
    return null;
  }
}
