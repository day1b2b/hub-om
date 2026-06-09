import type { OperationRepository } from "./operationRepository";
import { LocalJsonOperationRepository } from "./localJsonOperationRepository";
import { PrismaOperationRepository } from "./prismaOperationRepository";

export function getOperationRepository(): OperationRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local") {
    return new LocalJsonOperationRepository();
  }

  return new PrismaOperationRepository();
}
