import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getDuplicateCompanyMergeRepository } from "./duplicateCompanyMergeRepositoryFactory";
import type { DuplicateCompanyMergeRepository } from "./duplicateCompanyMergeRepository";
import { disconnectPrismaClient } from "./prisma";

interface Dependencies { getDefaultRepository: typeof getDuplicateCompanyMergeRepository; closeDefaultRepository(): Promise<void>; }
const defaults: Dependencies = { getDefaultRepository: getDuplicateCompanyMergeRepository, closeDefaultRepository: disconnectPrismaClient };

function oneValue(args: string[], name: string): string {
  const prefix = `--${name}=`; const values = args.filter(arg => arg.startsWith(prefix)).map(arg => arg.slice(prefix.length));
  if (values.length !== 1 || !values[0].trim()) throw new Error("Invalid duplicate company merge arguments.");
  return values[0];
}
export function parseDuplicateCompanyMergeArgs(args: string[]) {
  const allowed = args.every(arg => ["--dry-run", "--apply", "--backup-confirmed", "--maintenance-confirmed"].includes(arg) || arg.startsWith("--source=") || arg.startsWith("--target="));
  if (!allowed || args.includes("--dry-run") && args.includes("--apply")) throw new Error("Invalid duplicate company merge arguments.");
  const sourceName = oneValue(args, "source"), targetName = oneValue(args, "target"), apply = args.includes("--apply");
  if (sourceName === targetName) throw new Error("Source and target must differ.");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) throw new Error("Apply requires backup and maintenance confirmation.");
  return { sourceName, targetName, apply };
}
export async function runDuplicateCompanyMergeCommand(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const options = parseDuplicateCompanyMergeArgs(args), scoped = getDataRepositoryOverride("duplicateCompanyMerge");
  let result: Awaited<ReturnType<DuplicateCompanyMergeRepository["merge"]>> | undefined, failed = false;
  try { if (!scoped) loadEnvironment(); result = await (scoped ?? dependencies.getDefaultRepository()).merge(options); }
  catch { failed = true; }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { failed = true; } }
  if (failed || !result) throw new Error("DUPLICATE_COMPANY_MERGE_FAILED");
  return { options, result };
}
