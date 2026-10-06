import { readFile } from "node:fs/promises";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { disconnectPrismaClient } from "./prisma";
import { getOperationRepository } from "./operationRepositoryFactory";
import type { OperationRepository } from "./operationRepository";
import type { OperationCandidate } from "./operationMatch/matchOperation";
import { matchSatisfactionRow, parseSatisfactionCsv, type SatisfactionMatchResult } from "./satisfactionSheet";

const MAX_CSV_BYTES = 32 * 1024 * 1024;
export interface SatisfactionDryRunResult { candidates: number; limit: number; results: SatisfactionMatchResult[]; stats: { total: number; matched: number; ambiguous: number; unmatched: number }; }

export function parseSatisfactionDryRunArgs(args: string[]) {
  const csv = args.filter(value => value.startsWith("--csv=")), limits = args.filter(value => value.startsWith("--limit="));
  if (csv.length !== 1 || limits.length > 1 || args.some(value => !value.startsWith("--csv=") && !value.startsWith("--limit="))) throw new Error("SATISFACTION_DRY_RUN_FAILED");
  const csvPath = csv[0].slice("--csv=".length), limitText = limits[0]?.slice("--limit=".length), limit = limitText === undefined ? 200 : Number(limitText);
  if (!csvPath || csvPath.includes("\0") || !Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("SATISFACTION_DRY_RUN_FAILED");
  return { csvPath, limit };
}

export function matchSatisfactionCsv(source: string, operations: Awaited<ReturnType<OperationRepository["listOperations"]>>, limit: number): SatisfactionDryRunResult {
  if (Buffer.byteLength(source) > MAX_CSV_BYTES) throw new Error("SATISFACTION_DRY_RUN_FAILED");
  const rows = parseSatisfactionCsv(source).filter(row => row.overall !== "" || row.course !== "");
  const candidates: OperationCandidate[] = operations.map(operation => ({ id: operation.id, operationId: operation.operationId, companyName: operation.companyName, courseName: operation.courseName, startDate: operation.startDate, endDate: operation.endDate, timeText: operation.timeText, coachText: operation.coach, instructorsText: operation.instructors }));
  const results = rows.map(row => matchSatisfactionRow(row, candidates));
  return { candidates: candidates.length, limit, results, stats: { total: results.length, matched: results.filter(row => row.status === "matched").length, ambiguous: results.filter(row => row.status === "ambiguous").length, unmatched: results.filter(row => row.status === "unmatched").length } };
}

interface Dependencies { readSource(path: string): Promise<string>; getDefaultRepository(): OperationRepository; closeDefaultRepository(): Promise<void>; }
const defaults: Dependencies = { readSource: path => readFile(path, "utf8"), getDefaultRepository: getOperationRepository, closeDefaultRepository: disconnectPrismaClient };
export async function runSatisfactionDryRunCommand(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const options = parseSatisfactionDryRunArgs(args), scoped = getDataRepositoryOverride("operations");
  let completed = false, cleanupFailed = false;
  try {
    if (!scoped) { loadEnvironment(); if (!process.env.DATABASE_URL || process.env.OPERATION_DATA_SOURCE === "local") throw new Error("SATISFACTION_DRY_RUN_FAILED"); }
    const source = await dependencies.readSource(options.csvPath), operations = await (scoped ?? dependencies.getDefaultRepository()).listOperations();
    const result = matchSatisfactionCsv(source, operations, options.limit); completed = true; return result;
  } catch { throw new Error("SATISFACTION_DRY_RUN_FAILED"); }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { cleanupFailed = true; } if (completed && cleanupFailed) throw new Error("SATISFACTION_DRY_RUN_CLEANUP_FAILED"); }
}
