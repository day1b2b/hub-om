import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getCoachDbArchiveRepository } from "./coachDbArchiveRepositoryFactory";
import { readCoachDbArchiveSource } from "./coachDbArchiveSource";
export function parseCoachDbArchiveArgs(args: string[]) {
  const allowed = new Set(["--dry-run", "--apply"]); if (args.some(arg => !allowed.has(arg)) || args.includes("--dry-run") && args.includes("--apply")) throw new Error("COACH_DB_ARCHIVE_FAILED");
  return { apply: args.includes("--apply") };
}
export async function runCoachDbArchiveCommand(args: string[], env: Record<string, string | undefined>, loadEnvironment: () => void,
  dependencies = { readSource: readCoachDbArchiveSource }) {
  const options = parseCoachDbArchiveArgs(args), scoped = getDataRepositoryOverride("coachDbArchive"); if (!scoped) loadEnvironment();
  const sourceUrl = env.COACH_DB_DATABASE_URL?.trim(); if (!sourceUrl) throw new Error("COACH_DB_ARCHIVE_FAILED");
  try { const input = await dependencies.readSource(sourceUrl, options.apply); return { options, summary: await (scoped ?? getCoachDbArchiveRepository()).archive(input, options.apply) }; }
  catch { throw new Error("COACH_DB_ARCHIVE_FAILED"); }
}
