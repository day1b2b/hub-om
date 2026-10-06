import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachDbImportRepository } from "./prismaCoachDbImportRepository";
export function getCoachDbImportRepository(){return getDataRepositoryOverride("coachDbImport")??new PrismaCoachDbImportRepository();}
