import type { Session } from "next-auth";
import { assertAdminSession } from "./requireAdminSession";

/** 재사용을 위해 코드는 보존하되, 명시적으로 켜기 전에는 화면과 API 모두 닫는다. */
export function isSatisfactionMatchingEnabled(): boolean {
  return process.env.SATISFACTION_MATCHING_ENABLED === "true";
}

type SatisfactionMatchingAccess =
  | { ok: true; session: Session }
  | { ok: false; response: Response };

export async function authorizeSatisfactionMatching(): Promise<SatisfactionMatchingAccess> {
  if (!isSatisfactionMatchingEnabled()) {
    return {
      ok: false,
      response: Response.json({ ok: false, error: "사용하지 않는 기능입니다." }, { status: 404 })
    };
  }

  try {
    return { ok: true, session: await assertAdminSession() };
  } catch {
    return {
      ok: false,
      response: Response.json({ ok: false, error: "admin 권한이 필요합니다." }, { status: 403 })
    };
  }
}
