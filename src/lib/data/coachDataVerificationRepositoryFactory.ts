import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachDataVerificationRepository } from "./prismaCoachDataVerificationRepository";
export function getCoachDataVerificationRepository() {
  return getDataRepositoryOverride("coachDataVerification") ?? new PrismaCoachDataVerificationRepository();
}
