import type { ActivityChange, ActivityRequest, Prisma } from "@prisma/client";
import type { activityQuery } from "../../activity/query";
import type { feedQuery } from "../../activity/feed";
import type { usageFilters } from "../../activity/usage";

export type ActivityFilters = ReturnType<typeof activityQuery>;
export type ActivityFeedFilters = ReturnType<typeof feedQuery>;
export type ActivityUsageFilters = ReturnType<typeof usageFilters>;
export type ActivityLegacyWhere = Prisma.CoachContentEntryWhereInput | null;
export type ActivityRequestRow = Omit<ActivityRequest, "actorEmailPiiIndex" | "actorNamePiiIndex">;
export type ActivityChangeRow = Omit<ActivityChange, "actorEmailPiiIndex" | "actorNamePiiIndex">;
export type ActivityPresentedChange = ActivityChangeRow & {
  targetLabel: string | undefined; labelSource: string | null;
  targetHref: string | null; description: string | undefined;
};
export interface LegacyActivityRow {
  id: string; occurredAt: Date; actorName: string | null; actorEmail: string | null;
  actorType: string; targetType: string; targetId: string; targetLabel: string;
  labelSource: string; targetHref: string | null; action: string; description: string;
  legacy: boolean; changes: Record<string, never>; route: string | null; method: string;
}
export interface ActivityPage<T> { entries: T[]; nextCursor: string | null; }
export interface ActivitySummary { requests: number; changes: number; errors: number; users: number; }
export interface ActivityUsage extends ActivitySummary { automatedRequests: number; }
export interface ActivityReadRepository {
  adminList(filters: ActivityFilters): Promise<ActivityPage<ActivityRequestRow | ActivityPresentedChange>>;
  legacyList(where: ActivityLegacyWhere): Promise<ActivityPage<LegacyActivityRow>>;
  feed(filters: ActivityFeedFilters): Promise<ActivityPage<ActivityRequestRow | ActivityChangeRow> & { summary: ActivitySummary | undefined; fetchedAt: string }>;
  usage(filters: ActivityUsageFilters): Promise<ActivityUsage>;
}
