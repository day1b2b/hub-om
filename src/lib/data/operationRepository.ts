import type { CreateOperationInput, OperationSession, OperationSummary } from "./operationTypes";

export interface OperationRepository {
  listOperations(): Promise<OperationSession[]>;
  getOperationById(operationId: string): Promise<OperationSession | null>;
  createOperation(input: CreateOperationInput): Promise<OperationSession>;
  getSummary(): Promise<OperationSummary>;
}
