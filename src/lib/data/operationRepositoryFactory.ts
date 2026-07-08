import type { OperationRepository } from "./operationRepository";
import { LocalJsonOperationRepository } from "./localJsonOperationRepository";
import { PrismaOperationRepository } from "./prismaOperationRepository";

export function getOperationRepository(): OperationRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL) {
    return new LocalJsonOperationRepository();
  }

  return new PrismaOperationRepository();
}
