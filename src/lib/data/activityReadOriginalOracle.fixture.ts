/** Independent 39c70e2 query/formatter/legacy oracle. No new repository or presenter imports.
 * Module imports are consolidated below; original function bodies are unchanged.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient, ActivityChange } from "@prisma/client";
import { getPrismaClient } from "./prisma";
// Frozen 39c70e2: src/lib/activity/query.ts

const actions = new Set(["create", "update", "delete", "restore"]);
const actorTypes = new Set(["user", "token_request", "anonymous", "development"]);

export function activityQuery(params: URLSearchParams) {
  const tab = params.get("tab") === "requests" ? "requests" : "changes";
  const email = params.get("email")?.trim().slice(0, 254);
  const actorType = params.get("actorType");
  if (actorType && !actorTypes.has(actorType)) throw new Error("실행 주체를 확인하세요.");
  function boundary(key: string, nextDay: boolean) {
    const value = params.get(key);
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("날짜 형식을 확인하세요.");
    const date = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(date.getTime()) || new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10) !== value) throw new Error("유효한 날짜를 입력하세요.");
    return new Date(date.getTime() + (nextDay ? 86400000 : 0));
  }
  const from = boundary("from", false);
  const until = boundary("until", true);
  if (from && until && from >= until) throw new Error("조회 기간을 확인하세요.");
  const base = {
    ...(email ? { actorEmail: { contains: email, mode: "insensitive" as const } } : {}),
    ...(actorType ? { actorType } : {}),
    occurredAt: { ...(from ? { gte: from } : {}), ...(until ? { lt: until } : {}) }
  };
  const requestId = params.get("requestId");
  if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("요청 ID를 확인하세요.");
  const action = params.get("action");
  if (action && !actions.has(action)) throw new Error("작업 종류를 확인하세요.");
  const targetType = params.get("targetType")?.slice(0, 100);
  const targetId = params.get("targetId")?.slice(0, 300);
  const route = params.get("route")?.slice(0, 200);
  const changes: Prisma.ActivityChangeWhereInput = {
    ...base, ...(action ? { action } : {}), ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}), ...(requestId ? { requestId } : {})
  };
  const requests: Prisma.ActivityRequestWhereInput = {
    ...base, ...(requestId ? { id: requestId } : {}), ...(route ? { route: { contains: route } } : {}),
    ...(params.get("errors") === "true" ? { status: { gte: 400 } } : {})
  };
  const cursorValue = params.get("cursor");
  if (cursorValue) {
    const separator = cursorValue.indexOf("|");
    const occurredAt = new Date(cursorValue.slice(0, separator));
    const id = cursorValue.slice(separator + 1);
    if (separator < 0 || Number.isNaN(occurredAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("페이지 위치가 유효하지 않습니다.");
    const cursorFilter = { OR: [{ occurredAt: { lt: occurredAt } }, { occurredAt, id: { lt: id } }] };
    changes.AND = [cursorFilter];
    requests.AND = [cursorFilter];
  }
  return { tab, changes, requests };
}

// Frozen 39c70e2: src/lib/activity/feed.ts

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

// Frozen 39c70e2: src/lib/activity/usage.ts

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

// Frozen 39c70e2: src/lib/activity/legacy.ts

export function legacyAction(content: string) { return content.startsWith("메모 작성:") ? "create" : /^(메모 삭제:|리뷰 삭제)/.test(content) ? "delete" : "update"; }
export function legacyWhere(params: URLSearchParams): Prisma.CoachContentEntryWhereInput | null {
  const parsed = activityQuery(params);
  if (params.get("requestId") || (params.get("actorType") && params.get("actorType") !== "user") || (params.get("targetType") && params.get("targetType") !== "coaches") || params.get("action") === "restore") return null;
  const where: Prisma.CoachContentEntryWhereInput = { kind: "EDIT_HISTORY", createdAt: parsed.changes.occurredAt as Prisma.DateTimeFilter };
  if (params.get("email")) where.authorEmail = { contains: params.get("email")!.trim().slice(0, 254), mode: "insensitive" };
  if (params.get("targetId")) {
    const id = params.get("targetId")!;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    where.coachId = id;
  }
  const creation = { content: { startsWith: "메모 작성:" } };
  const deletion = { OR: [{ content: { startsWith: "메모 삭제:" } }, { content: { startsWith: "리뷰 삭제" } }] };
  if (params.get("action") === "create") where.AND = [creation];
  if (params.get("action") === "delete") where.AND = [deletion];
  if (params.get("action") === "update") where.NOT = [creation, deletion];
  const cursor = params.get("cursor");
  if (cursor) {
    const [stamp, id] = cursor.split("|");
    const createdAt = new Date(stamp);
    const prior = Array.isArray(where.AND) ? where.AND : [];
    where.AND = [...prior, { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
  }
  return where;
}

// Frozen 39c70e2: src/lib/activity/presentation.ts
type Change = { before?: unknown; after?: unknown; redacted?: boolean };
export function changedText(changes: unknown, field: string) {
  const change = (changes as Record<string, Change>)?.[field];
  if (!change || change.redacted) return undefined;
  const value = change.after ?? change.before;
  return typeof value === "string" ? value : undefined;
}
export async function describeChanges(db: PrismaClient, rows: ActivityChange[]) {
  const ids = (kind: string) => rows.filter(r => r.targetType === kind && /^[0-9a-f-]{36}$/i.test(r.targetId)).map(r => r.targetId);
  const operationIds = rows.flatMap(r => r.targetType === "calendar_event_links" ? [changedText(r.changes, "operation_id")].filter((v): v is string => Boolean(v)) : []);
  const [operations, coaches, courses, companies, notes, engagements] = await Promise.all([
    db.operationSession.findMany({ where: { OR: [{ id: { in: ids("operation_sessions") } }, { operationId: { in: operationIds } }] }, select: { id: true, operationId: true, roundNo: true, course: { select: { name: true, company: { select: { name: true } } } } } }),
    db.coach.findMany({ where: { id: { in: ids("coaches") } }, select: { id: true, name: true, deletedAt: true } }),
    db.course.findMany({ where: { id: { in: ids("courses") } }, select: { id: true, name: true, company: { select: { name: true } } } }),
    db.company.findMany({ where: { id: { in: ids("companies") } }, select: { id: true, name: true } }),
    db.coachContentEntry.findMany({ where: { id: { in: ids("coach_content_entries") } }, select: { id: true, coach: { select: { id: true, name: true, deletedAt: true } } } }),
    db.coachEngagement.findMany({ where: { id: { in: ids("coach_engagements") } }, select: { id: true, coach: { select: { id: true, name: true, deletedAt: true } } } })
  ]);
  return rows.map(row => {
    const op = operations.find(o => row.targetType === "operation_sessions" ? o.id === row.targetId : row.targetType === "calendar_event_links" && o.operationId === changedText(row.changes, "operation_id"));
    const coach = row.targetType === "coaches" ? coaches.find(c => c.id === row.targetId)
      : row.targetType === "coach_content_entries" ? notes.find(n => n.id === row.targetId)?.coach
      : row.targetType === "coach_engagements" ? engagements.find(e => e.id === row.targetId)?.coach : undefined;
    const course = row.targetType === "courses" ? courses.find(c => c.id === row.targetId) : undefined;
    const company = row.targetType === "companies" ? companies.find(c => c.id === row.targetId) : undefined;
    const targetLabel = op ? `${op.course.company.name} · ${op.course.name}${op.roundNo ? ` · ${op.roundNo}${/[차회]/.test(op.roundNo) ? "" : "회차"}` : ""}` : coach?.name ?? (course ? `${course.company.name} · ${course.name}` : company?.name);
    const savedLabel = changedText(row.changes, "name") ?? changedText(row.changes, "course_name") ?? changedText(row.changes, "title");
    return { ...row, targetLabel: targetLabel ?? savedLabel, labelSource: targetLabel ? "현재 정보" : savedLabel ? "기록 당시" : null,
      targetHref: op ? `/operations/${encodeURIComponent(op.operationId)}` : coach && !coach.deletedAt ? `/coaches/${coach.id}` : null,
      description: row.targetType === "calendar_event_links" ? ({ create: "교육 일정의 캘린더 연결을 등록했습니다", update: "교육 일정의 캘린더 연결을 수정했습니다", delete: "교육 일정의 캘린더 연결을 삭제했습니다" } as Record<string, string>)[row.action] : undefined };
  });
}

export function originalActivityReadOracle(prisma: ReturnType<typeof getPrismaClient>) {
 return {
 async adminList(filters: ReturnType<typeof activityQuery>) {
 const orderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
 const rows = filters.tab === "requests"
      ? await prisma.activityRequest.findMany({ where: { AND: [filters.requests, { route: { notIn: monitoringRoutes } }] }, orderBy, take: 51 })
      : await prisma.activityChange.findMany({ where: filters.changes, orderBy, take: 51 });
    const entries = filters.tab === "requests" ? rows.slice(0, 50) : await describeChanges(prisma, rows.slice(0, 50) as import("@prisma/client").ActivityChange[]);
    const last = entries.at(-1);

 return { entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null };
 },
 async legacyList(where: Prisma.CoachContentEntryWhereInput | null) {
 const rows = where ? await prisma.coachContentEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, select: { id: true, createdAt: true, authorName: true, authorEmail: true, content: true, sourceField: true, coachId: true, coach: { select: { name: true, deletedAt: true } } } }) : [];
      const entries = rows.slice(0, 50).map(row => ({ id: row.id, occurredAt: row.createdAt, actorName: row.authorName, actorEmail: row.authorEmail, actorType: "user", targetType: "coaches", targetId: row.coachId, targetLabel: row.coach.name, labelSource: "현재 정보", targetHref: row.coach.deletedAt ? null : `/coaches/${row.coachId}`, action: legacyAction(row.content), description: row.content, legacy: true, changes: {}, route: row.sourceField, method: "" }));
      const last = entries.at(-1);

 return { entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null };
 },
 async feed(filters: ReturnType<typeof feedQuery>) {
 return prisma.$transaction(async tx => {
      const orderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
      const rows = filters.list.tab === "requests"
        ? await tx.activityRequest.findMany({ where: filters.list.requests, orderBy, take: 51 })
        : await tx.activityChange.findMany({ where: filters.list.changes, orderBy, take: 51 });
      const entries = rows.slice(0, 50);
      const last = entries.at(-1);
      let summary;
      if (filters.includeSummary) {
        const where = filters.summary.requests;
        const [requests, changes, errors, users] = await Promise.all([
          tx.activityRequest.count({ where }),
          tx.activityChange.count({ where: filters.summary.changes }),
          tx.activityRequest.count({ where: { AND: [where, { status: { gte: 400 } }] } }),
          tx.activityRequest.groupBy({ by: ["actorEmailPiiIndex"], where: { AND: [where, { actorEmail: { not: null } }] } })
        ]);
        summary = { requests, changes, errors, users: users.length };
      }
      return { entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null, summary, fetchedAt: new Date().toISOString() };
    }, { isolationLevel: "RepeatableRead", timeout: 8000, maxWait: 2000 });
 },
 async usage(filters: ReturnType<typeof usageFilters>) {
 return prisma.$transaction(async tx => {
      const [requests, errors, automatedRequests, changes, users] = await Promise.all([
        tx.activityRequest.count({ where: filters.human }),
        tx.activityRequest.count({ where: { AND: [filters.human, { status: { gte: 400 } }] } }),
        tx.activityRequest.count({ where: filters.automated }),
        tx.activityChange.count({ where: { occurredAt: filters.occurredAt, actorType: "user" } }),
        tx.activityRequest.groupBy({ by: ["actorEmailPiiIndex"], where: { AND: [filters.human, { actorEmail: { not: null } }] }, _count: { _all: true } })
      ]);
      return { requests, errors, automatedRequests, changes, users: users.length };
    }, { isolationLevel: "RepeatableRead", timeout: 8000 });
 }
 };
}
