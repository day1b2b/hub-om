import { SourceTeam } from "@prisma/client";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { SourceOnlyPromotionRepository } from "./importPromotionContract";
import { disconnectPrismaClient } from "./prisma";
import { getSourceOnlyPromotionRepository } from "./sourceOnlyPromotionRepositoryFactory";

const TEAM_BY_ARGUMENT: Record<string, SourceTeam> = { team_1: SourceTeam.TEAM_1, team_2: SourceTeam.TEAM_2, unknown: SourceTeam.UNKNOWN };

export function parseSourceOnlyPromotionArgs(args: string[]) {
  const flags = args.filter(arg => arg.startsWith("--"));
  const positional = args.filter(arg => !arg.startsWith("--"));
  const allowed = new Set(["--dry-run", "--apply", "--backup-confirmed", "--maintenance-confirmed"]);
  if (flags.some(flag => !allowed.has(flag)) || positional.length > 1 || args.includes("--dry-run") && args.includes("--apply")) {
    throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  }
  const sourceTeam = TEAM_BY_ARGUMENT[positional[0] ?? "team_1"];
  if (!sourceTeam) throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  }
  return { apply, sourceTeam };
}

export function assertSafeSourceOnlyPromotionDatabase(databaseUrl: string | undefined, allowNonLocal: string | undefined) {
  if (!databaseUrl) throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  let host: string;
  try { host = new URL(databaseUrl).hostname; } catch { throw new Error("SOURCE_ONLY_PROMOTION_FAILED"); }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && allowNonLocal !== "true") {
    throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  }
}

interface Dependencies {
  getDefaultRepository(): SourceOnlyPromotionRepository;
  closeDefaultRepository(): Promise<void>;
}
const defaults: Dependencies = { getDefaultRepository: getSourceOnlyPromotionRepository, closeDefaultRepository: disconnectPrismaClient };

export async function runSourceOnlyPromotionCommand(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const options = parseSourceOnlyPromotionArgs(args);
  const scoped = getDataRepositoryOverride("sourceOnlyPromotion");
  let result: Awaited<ReturnType<SourceOnlyPromotionRepository["promoteSourceOnlyRows"]>> | undefined;
  let failed = false;
  let completed = false;
  let cleanupFailed = false;
  try {
    if (!scoped) {
      loadEnvironment();
      assertSafeSourceOnlyPromotionDatabase(process.env.DATABASE_URL, process.env.ALLOW_NON_LOCAL_SOURCE_ONLY_PROMOTION);
    }
    result = await (scoped ?? dependencies.getDefaultRepository()).promoteSourceOnlyRows(options.sourceTeam, options.apply);
    completed = true;
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { cleanupFailed = true; } }
  if (completed && cleanupFailed) throw new Error("SOURCE_ONLY_PROMOTION_CLEANUP_FAILED");
  if (cleanupFailed) failed = true;
  if (failed || !result) throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  return { options, result };
}
