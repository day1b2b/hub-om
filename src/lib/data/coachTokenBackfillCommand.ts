import { parseCoachTokenBackfillArgs } from "./coachAccessTokenBackfill";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getCoachTokenBackfillRepository } from "./coachTokenBackfillRepositoryFactory";

/** Shared by the real CLI and explicitly scoped synthetic validation.
 * Invalid flags and missing scoped services fail before environment/DB access.
 * A scoped backend never loads the production env files.
 */
export async function runCoachTokenBackfillCommand(args: string[], loadEnvironment: () => void) {
  const options = parseCoachTokenBackfillArgs(args);
  const scoped = getDataRepositoryOverride("coachTokenBackfill");
  if (!scoped) loadEnvironment();
  try {
    const summary = await (scoped ?? getCoachTokenBackfillRepository()).backfill(options);
    return { options, summary };
  } catch {
    throw new Error("COACH_TOKEN_BACKFILL_FAILED");
  }
}
