import type { OperationRepository } from "./operationRepository";
import { PrismaOperationRepository } from "./prismaOperationRepository";

export function getOperationRepository(): OperationRepository {
  return new PrismaOperationRepository();
}
