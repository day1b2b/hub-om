import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachDbArchiveRepository } from "./prismaCoachDbArchiveRepository";
export function getCoachDbArchiveRepository() { return getDataRepositoryOverride("coachDbArchive") ?? new PrismaCoachDbArchiveRepository(); }
