import type { CoachEvaluationRepository } from "./coachEvaluationRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachEvaluationRepository } from "./prismaCoachEvaluationRepository";

export function getCoachEvaluationRepository(): CoachEvaluationRepository {
  return getDataRepositoryOverride("coachEvaluation") ?? new PrismaCoachEvaluationRepository();
}
