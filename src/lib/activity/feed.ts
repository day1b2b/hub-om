import { createHash, timingSafeEqual } from "node:crypto";
import { activityQuery } from "./query";

export function authorizeActivityFeed(headers: Headers, key = process.env.ACTIVITY_FEED_KEY): 200 | 401 | 503 {
  if (!key || key.length < 32) return 503;
  const value = headers.get("authorization") ?? "";
  if (!value.startsWith("Bearer ") || value.length > 512) return 401;
  const digest = (input: string) => createHash("sha256").update(input).digest();
  return timingSafeEqual(digest(value.slice(7)), digest(key)) ? 200 : 401;
}

/** The private viewer supports bounded KST calendar-day windows. */
export function feedQuery(input: URLSearchParams, now = new Date()) {
  if (input.toString().length > 2048) throw new Error("조회 조건이 너무 깁니다.");
  const period = input.get("period") ?? "7";
  if (!["1", "7", "30", "90", "365"].includes(period)) throw new Error("조회 기간을 확인하세요.");
  const params = new URLSearchParams(input);
  const today = new Date(now.getTime() + 9 * 3600000);
  params.set("until", today.toISOString().slice(0, 10));
  params.set("from", new Date(today.getTime() - (Number(period) - 1) * 86400000).toISOString().slice(0, 10));
  const list = activityQuery(params);
  // Summary measures period/user activity independently of table-specific filters and cursor.
  const summaryParams = new URLSearchParams();
  for (const key of ["from", "until", "email", "actorType"]) {
    const value = params.get(key);
    if (value) summaryParams.set(key, value);
  }
  return { list, summary: activityQuery(summaryParams), includeSummary: params.get("summary") === "true" };
}
