import { disconnectPrismaClient } from "./prisma";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getCoachOperationMatchRepository } from "./coachOperationMatchRepositoryFactory";
import { matchOperation, rankOperationCandidates } from "./operationMatch/matchOperation";
import type { CoachOperationMatchEngagement } from "./coachOperationMatchRepository";
import type { CoachOperationMatchRepository } from "./coachOperationMatchRepository";

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const input = (row: CoachOperationMatchEngagement) => ({ courseName: row.courseName, coachName: row.coachName,
  startDate: dateOnly(row.startDate), endDate: dateOnly(row.endDate), startTime: row.startTime, endTime: row.endTime,
  scheduleDates: row.scheduleDates, scheduleTimes: row.scheduleTimes });

export interface CoachOperationBackfillSummary { checked: number; matched: number; unmatched: number; updated: number; apply: boolean; }
export interface CoachOperationDiagnostic {
  limit: number;
  counts: { total: number; matched: number; unmatched: number };
  topCourseNames: Array<{ courseName: string; count: number }>;
  rows: Array<Record<string, string | number>>;
}

interface Dependencies { getDefaultRepository(): CoachOperationMatchRepository; closeDefaultRepository(): Promise<void>; }
const defaults: Dependencies = { getDefaultRepository: getCoachOperationMatchRepository, closeDefaultRepository: disconnectPrismaClient };

export async function runCoachOperationBackfillCommand(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults): Promise<CoachOperationBackfillSummary> {
  const scoped = getDataRepositoryOverride("coachOperationMatch");
  if (!scoped) loadEnvironment();
  const repository = scoped ?? dependencies.getDefaultRepository();
  let summary: CoachOperationBackfillSummary | undefined, failed = false;
  try {
    const snapshot = await repository.readSnapshot();
    const matches = snapshot.engagements.map(row => ({ engagementId: row.id, operationSessionId: matchOperation(input(row), snapshot.candidates) })).filter((row): row is { engagementId: string; operationSessionId: string } => !!row.operationSessionId);
    const apply = args.includes("--apply");
    summary = { checked: snapshot.engagements.length, matched: matches.length, unmatched: snapshot.engagements.length - matches.length,
      updated: apply ? await repository.applyMatches(matches) : 0, apply };
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { failed = true; } }
  if (failed || !summary) throw new Error("COACH_OPERATION_MATCH_FAILED");
  return summary;
}

export async function runCoachOperationDiagnoseCommand(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults): Promise<CoachOperationDiagnostic> {
  const scoped = getDataRepositoryOverride("coachOperationMatch");
  if (!scoped) loadEnvironment();
  const repository = scoped ?? dependencies.getDefaultRepository();
  let diagnostic: CoachOperationDiagnostic | undefined, failed = false;
  try {
    const snapshot = await repository.readSnapshot();
    const parsed = Number(args.find(value => value.startsWith("--limit="))?.slice(8));
    const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
    const counts = new Map<string, number>();
    for (const row of snapshot.engagements) counts.set(row.courseName, (counts.get(row.courseName) ?? 0) + 1);
    const topCourseNames = [...counts].map(([courseName, count]) => ({ courseName, count })).sort((a, b) => b.count - a.count).slice(0, 15);
    const rows = snapshot.engagements.slice(0, limit).map(row => {
      const ranked = rankOperationCandidates(input(row), snapshot.candidates), best = ranked.find(item => item.score > 0);
      const nearest = ranked.find(item => item.score === 0 && item.dateScore > 0 && item.courseScore === 0);
      return { engagement: row.courseName, coach: row.coachName ?? "", dates: `${dateOnly(row.startDate)}~${dateOnly(row.endDate)}`,
        schedules: row.scheduleDates.join(","), bestOperation: best?.candidate.operationId ?? "", bestCompany: best?.candidate.companyName ?? "",
        bestCourse: best?.candidate.courseName ?? "", bestDates: best ? `${best.candidate.startDate}~${best.candidate.endDate}` : "",
        score: best?.score ?? 0, courseScore: best?.courseScore ?? 0, dateScore: best?.dateScore ?? 0,
        timeScore: best?.timeScore ?? 0, coachScore: best?.coachScore ?? 0,
        dateOnlyCandidate: nearest ? `${nearest.candidate.companyName ?? ""} / ${nearest.candidate.courseName}` : "" };
    });
    diagnostic = { limit, counts: snapshot.counts, topCourseNames, rows };
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { failed = true; } }
  if (failed || !diagnostic) throw new Error("COACH_OPERATION_MATCH_FAILED");
  return diagnostic;
}
