import { getPrismaClient } from "./prisma";
import { PrismaTeamMemberImportRepository } from "./prismaTeamMemberImportRepository";
export function getTeamMemberImportRepository() { return new PrismaTeamMemberImportRepository(getPrismaClient()); }
