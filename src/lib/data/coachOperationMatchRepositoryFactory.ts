import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachOperationMatchRepository } from "./prismaCoachOperationMatchRepository";

export function getCoachOperationMatchRepository() {
  return getDataRepositoryOverride("coachOperationMatch") ?? new PrismaCoachOperationMatchRepository();
}
