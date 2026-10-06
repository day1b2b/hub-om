import { getPrismaClient } from "./prisma";
import { PrismaInstructorNoteImportRepository } from "./prismaInstructorNoteImportRepository";
export function getInstructorNoteImportRepository() { return new PrismaInstructorNoteImportRepository(getPrismaClient()); }
