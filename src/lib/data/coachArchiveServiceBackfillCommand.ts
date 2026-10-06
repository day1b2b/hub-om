import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getCoachArchiveServiceBackfillRepository } from "./coachArchiveServiceBackfillRepositoryFactory";

export function parseCoachArchiveServiceBackfillArgs(args: string[]): { apply: boolean } {
  const allowed = new Set(["--dry-run", "--apply", "--backup-confirmed", "--maintenance-confirmed"]);
  if (args.some(arg => !allowed.has(arg)) || (args.includes("--dry-run") && args.includes("--apply"))) {
    throw new Error("Invalid backfill arguments.");
  }
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("Apply requires backup and maintenance confirmation.");
  }
  return { apply };
}

export async function runCoachArchiveServiceBackfillCommand(args: string[], loadEnvironment: () => void) {
  const options = parseCoachArchiveServiceBackfillArgs(args);
  const scoped = getDataRepositoryOverride("coachArchiveServiceBackfill");
  if (!scoped) loadEnvironment();
  try {
    const summary = await (scoped ?? getCoachArchiveServiceBackfillRepository()).backfill(options);
    return { options, summary };
  } catch {
    throw new Error("COACH_ARCHIVE_SERVICE_BACKFILL_FAILED");
  }
}
