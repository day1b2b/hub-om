import { getPrismaClient } from "../prisma";
import { describeChanges } from "../../activity/presentation";
import { legacyAction } from "../../activity/legacy";
import { monitoringRoutes } from "../../activity/usage";
import type { ActivityRequestRow, ActivityReadRepository, ActivityFilters, ActivityLegacyWhere, ActivityFeedFilters, ActivityUsageFilters } from "./activityReadRepository";

/** Production default; query/select/transaction behavior is retained from the routes. */
export class PrismaActivityReadRepository implements ActivityReadRepository {
  async adminList(filters: ActivityFilters) {
    const prisma = getPrismaClient();
    const orderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
    const rows = filters.tab === "requests"
      ? await prisma.activityRequest.findMany({ where: { AND: [filters.requests, { route: { notIn: monitoringRoutes } }] }, orderBy, take: 51 })
      : await prisma.activityChange.findMany({ where: filters.changes, orderBy, take: 51 });
    const entries = filters.tab === "requests" ? rows.slice(0, 50) as ActivityRequestRow[] : await describeChanges(prisma, rows.slice(0, 50) as import("@prisma/client").ActivityChange[]);
    const last = entries.at(-1);
    return { entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null };
  }
  async legacyList(where: ActivityLegacyWhere) {
    const prisma = getPrismaClient();
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
    const rows = where ? await prisma.coachContentEntry.findMany({ where, orderBy, take: 51, select: { id: true, createdAt: true, authorName: true, authorEmail: true, content: true, sourceField: true, coachId: true, coach: { select: { name: true, deletedAt: true } } } }) : [];
    const entries = rows.slice(0, 50).map(row => ({ id: row.id, occurredAt: row.createdAt, actorName: row.authorName, actorEmail: row.authorEmail, actorType: "user", targetType: "coaches", targetId: row.coachId, targetLabel: row.coach.name, labelSource: "현재 정보", targetHref: row.coach.deletedAt ? null : `/coaches/${row.coachId}`, action: legacyAction(row.content), description: row.content, legacy: true, changes: {}, route: row.sourceField, method: "" }));
    const last = entries.at(-1);
    return { entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null };
  }
  async feed(filters: ActivityFeedFilters) {
    return getPrismaClient().$transaction(async tx => {
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
  }
  async usage(filters: ActivityUsageFilters) {
    return getPrismaClient().$transaction(async tx => {
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
}
