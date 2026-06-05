import type { OperationSession, OperationSummary } from "./operationTypes";

export interface OperationRepository {
  listOperations(): Promise<OperationSession[]>;
  getOperationById(operationId: string): Promise<OperationSession | null>;
  getSummary(): Promise<OperationSummary>;
}
