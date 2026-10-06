import { disconnectPrismaClient } from "./prisma";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getCoachDataVerificationRepository } from "./coachDataVerificationRepositoryFactory";

export async function runCoachDataVerificationCommand(args: string[], loadEnvironment: () => void) {
  if (args.length) throw new Error("COACH_DATA_VERIFICATION_FAILED");
  const scoped = getDataRepositoryOverride("coachDataVerification");
  if (!scoped) loadEnvironment();
  try { return await (scoped ?? getCoachDataVerificationRepository()).readReport(); }
  catch { throw new Error("COACH_DATA_VERIFICATION_FAILED"); }
  finally { if (!scoped) await disconnectPrismaClient(); }
}
