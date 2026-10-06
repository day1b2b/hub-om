import { getDriveImportWriterRepository } from "../data/driveImportWriterFactory";
import { getDriveImportSource } from "../data/driveImportSource";
import type { DriveImportArgs, DriveImportFinishedStatus, DriveImportInput, DriveImportOperation, DriveImportSummary } from "../data/driveImportWriterRepository";
import type { DriveImportCandidate } from "./driveImportTypes";

export function parseDriveImportArgs(argv: readonly string[], concurrencyEnv?: string): DriveImportArgs {
  const args = {
    concurrency: Number(concurrencyEnv || 3),
    limit: 0,
    mode: "dry_run"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") args.limit = Number(argv[index + 1] ?? 0);
    if (arg === "--concurrency") args.concurrency = Number(argv[index + 1] ?? 3);
    if (arg === "--mode") args.mode = String(argv[index + 1] ?? "dry_run");
  }

  args.concurrency = Number.isFinite(args.concurrency) && args.concurrency > 0 ? Math.floor(args.concurrency) : 3;
  args.limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 0;
  return args;
}

function pickScanInput(operation: DriveImportOperation): DriveImportInput | null {
  if (operation.driveLink?.trim()) return { kind: "driveLink", value: operation.driveLink.trim() };
  if (operation.lectureManagementLink?.trim()) {
    return { kind: "lectureManagementLink", value: operation.lectureManagementLink.trim() };
  }
  return null;
}

function summarizeSuspicious(candidates: ReturnType<typeof keyCandidate>[]) {
  return {
    zeroSatisfactionCandidates: candidates.filter(
      (candidate) =>
        (candidate.field === "avgSatisfaction" || candidate.field === "instructorSatisfaction") &&
        candidate.value === "0.00"
    ).length,
    clockInstructorCandidates: candidates.filter(
      (candidate) => candidate.field === "instructors" && candidate.value === "시계"
    ).length,
    badInstructorFragments: candidates.filter(
      (candidate) => candidate.field === "instructors" && candidate.value === "등에서도"
    ).length
  };
}

function keyCandidate(candidate: DriveImportCandidate) {
  return {
    confidence: candidate.confidence,
    evidence: candidate.evidence ?? "",
    field: candidate.field,
    label: candidate.label,
    sourceTitle: candidate.sourceTitle,
    value: candidate.value
  };
}

/** Preserve per-result writes and Promise.all's non-cancelling failure behavior.
 * Resolving both ports before the first call prevents partial scopes from doing IO.
 * Client lifetime belongs to the caller; only the direct CLI closes its repository.
 */
export async function runDriveImportDryRun(
  args: DriveImportArgs,
  progress?: (message: string) => void
): Promise<{ runId: string; status: DriveImportFinishedStatus; summary: DriveImportSummary }> {
  const repository = getDriveImportWriterRepository();
  const source = getDriveImportSource();
  const operations = await repository.loadOperations(args.limit);
  const runId = await repository.createRun(args, operations.length);
  const summary: DriveImportSummary = {
    avgSatisfactionCandidates: 0,
    errors: 0,
    folderSearches: 0,
    folderSearchWithCandidates: 0,
    instructorCandidates: 0,
    instructorSatisfactionCandidates: 0,
    scanFoundFolder: 0,
    scanIssues: 0,
    scannedRefs: 0,
    suspicious: {
      badInstructorFragments: 0,
      clockInstructorCandidates: 0,
      zeroSatisfactionCandidates: 0
    },
    suspiciousCandidateCount: 0
  };
  let processed = 0;

  async function processOperation(operation: DriveImportOperation) {
    const input = pickScanInput(operation);

    try {
      if (input) {
        summary.scannedRefs += 1;
        const scan = await source.scan(input.value);
        const candidates = scan.candidates.map(keyCandidate);
        const suspicious = summarizeSuspicious(candidates);

        summary.scanFoundFolder += scan.folderId ? 1 : 0;
        summary.scanIssues += scan.issues.length ? 1 : 0;
        summary.avgSatisfactionCandidates += candidates.filter((candidate) => candidate.field === "avgSatisfaction").length;
        summary.instructorSatisfactionCandidates += candidates.filter((candidate) => candidate.field === "instructorSatisfaction").length;
        summary.instructorCandidates += candidates.filter((candidate) => candidate.field === "instructors").length;
        summary.suspicious.zeroSatisfactionCandidates += suspicious.zeroSatisfactionCandidates;
        summary.suspicious.clockInstructorCandidates += suspicious.clockInstructorCandidates;
        summary.suspicious.badInstructorFragments += suspicious.badInstructorFragments;
        summary.suspiciousCandidateCount +=
          suspicious.zeroSatisfactionCandidates + suspicious.clockInstructorCandidates + suspicious.badInstructorFragments;

        await repository.appendResult(runId, operation, input, {
          candidateCount: candidates.length,
          fileCount: scan.files.length,
          folderId: scan.folderId,
          folderTitle: scan.folderTitle,
          folderUrl: scan.folderUrl,
          issues: scan.issues,
          keyCandidates: candidates.filter((candidate) =>
            ["driveLink", "lectureManagementLink", "resultReportLink", "avgSatisfaction", "instructorSatisfaction", "instructors"].includes(candidate.field)
          ),
          resultKind: scan.folderId ? "scan_found_folder" : "scan_no_folder"
        });
      } else {
        summary.folderSearches += 1;
        const search = await source.search(operation);
        summary.folderSearchWithCandidates += search.candidates.length ? 1 : 0;
        await repository.appendResult(runId, operation, { kind: "folderSearch", value: "" }, {
          candidateCount: search.candidates.length,
          folderCandidates: search.candidates.slice(0, 10).map((candidate) => ({
            confidence: candidate.confidence,
            reasons: candidate.reasons,
            score: candidate.score,
            title: candidate.title,
            url: candidate.url
          })),
          issues: search.issues,
          resultKind: search.candidates.length ? "folder_search_candidates" : "folder_search_empty"
        });
      }
    } catch (error) {
      summary.errors += 1;
      await repository.appendResult(runId, operation, input ?? { kind: "folderSearch", value: "" }, {
        error: error instanceof Error ? error.message : String(error),
        resultKind: "error"
      });
    } finally {
      processed += 1;
      if (processed % 25 === 0 || processed === operations.length) {
        progress?.(`[drive-import-dry-run] ${processed}/${operations.length}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(args.concurrency, operations.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < operations.length; index += args.concurrency) {
      await processOperation(operations[index]);
    }
  });

  await Promise.all(workers);
  const status = summary.errors > 0 ? "completed_with_errors" : "completed";
  await repository.finishRun(runId, summary, status);
  return { runId, status, summary };
}
