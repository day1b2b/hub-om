import { createHmac, timingSafeEqual } from "node:crypto";
import type { CalendarEventLink } from "./calendarEventLinkRepository";
export interface CalendarCleanupClaim {
  version: 1;
  link: CalendarEventLink;
  operationRevision: string;
  etag: string;
  expiresAt: number;
}
function key(): string {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("삭제 미리보기 서명에 AUTH_SECRET이 필요합니다.");
  return secret;
}
function signature(payload: string): Buffer {
  return createHmac("sha256", key()).update(`hub-om-calendar-cleanup-v1:${payload}`).digest();
}
export function signCalendarCleanup(claim: CalendarCleanupClaim): string {
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyCalendarCleanup(token: string, options?: { allowExpired?: boolean }): CalendarCleanupClaim {
  if (token.length > 12000) throw new Error("삭제 미리보기 토큰이 너무 큽니다.");
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) throw new Error("삭제 미리보기 토큰 형식이 잘못되었습니다.");
  const actual = Buffer.from(mac, "base64url");
  const expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("삭제 미리보기 서명이 일치하지 않습니다.");
  const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CalendarCleanupClaim;
  if (claim.version !== 1 || !Number.isFinite(claim.expiresAt) || (!options?.allowExpired && claim.expiresAt <= Date.now())) throw new Error("삭제 미리보기가 만료되었습니다. 다시 조회하세요.");
  if (!claim.link?.operationId || !claim.link.calendarId || !claim.link.eventId || !claim.link.eventDate || !claim.etag || !claim.operationRevision) throw new Error("삭제 미리보기 정보가 불완전합니다.");
  return claim;
}
