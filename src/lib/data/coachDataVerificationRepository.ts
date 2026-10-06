export interface VerificationCount { label: string; count: number; }
export interface CoachImportSummary {
  mode: string; status: string; coachCount: number; engagementCount: number;
  scheduleCount: number; matchedOperationCount: number; errorCount: number; finishedAt: Date | null;
}
export interface CoachArchiveSummary {
  id: string; tableCount: number; rowCount: number; status: string; finishedAt: Date | null;
}
export interface CoachDataVerificationReport {
  serviceCounts: VerificationCount[];
  latestImport: CoachImportSummary | null;
  latestArchive: CoachArchiveSummary | null;
  archiveCounts: VerificationCount[];
}
export interface CoachDataVerificationRepository { readReport(): Promise<CoachDataVerificationReport>; }

const pairs = [
  ["coaches", "coaches_total"], ["engagements", "engagements"],
  ["coach_schedules", "schedules"], ["engagement_schedules", "engagement_schedules"],
] as const;
export function compareCoachVerificationCounts(archiveCounts: VerificationCount[], serviceCounts: VerificationCount[], archiveAvailable: boolean) {
  if (!archiveAvailable) return [];
  const archive = new Map(archiveCounts.map(row => [row.label, row.count]));
  const service = new Map(serviceCounts.map(row => [row.label, row.count]));
  return pairs.map(([archiveLabel, serviceLabel]) => {
    const archiveCount = archive.get(archiveLabel) ?? 0, serviceCount = service.get(serviceLabel) ?? 0;
    return { archive: archiveLabel, service: serviceLabel, archive_count: archiveCount, service_count: serviceCount,
      diff: serviceCount - archiveCount, ok: archiveCount === serviceCount };
  });
}
