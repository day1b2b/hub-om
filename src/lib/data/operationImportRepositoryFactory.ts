import { getPrismaClient } from "./prisma";
import { PrismaOperationImportRepository } from "./prismaOperationImportRepository";
export function getOperationImportRepository() { return new PrismaOperationImportRepository(getPrismaClient()); }
