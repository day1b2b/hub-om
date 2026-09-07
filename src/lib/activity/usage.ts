import type { Prisma } from "@prisma/client";
import { activityQuery } from "./query";

export const monitoringRoutes = ["/api/admin/activity", "/api/admin/activity/usage", "/api/activity-feed"];
export function koreaDate(now = new Date()) { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function usageFilters(date: string, now = new Date()) {
  const today = koreaDate(now);
  const earliest = koreaDate(new Date(now.getTime() - 29 * 86400000));
  activityQuery(new URLSearchParams({ from: date, until: date }));
  if (date < earliest || date > today) throw new Error("최근 30일 안의 날짜를 선택하세요.");
  const occurredAt = { gte: new Date(`${date}T00:00:00+09:00`), lt: new Date(new Date(`${date}T00:00:00+09:00`).getTime() + 86400000) };
  const human: Prisma.ActivityRequestWhereInput = { occurredAt, actorType: "user", route: { notIn: monitoringRoutes } };
  const automated: Prisma.ActivityRequestWhereInput = { occurredAt, actorType: "token_request", route: { notIn: monitoringRoutes } };
  return { human, automated, occurredAt };
}
