import type { CreateOperationInput, OperationSession, OperationSummary, UpdateOperationInput } from "./operationTypes";

export interface OperationRepository {
  listOperations(): Promise<OperationSession[]>;
  getOperationById(operationId: string): Promise<OperationSession | null>;
  createOperation(input: CreateOperationInput): Promise<OperationSession>;
  updateOperation(operationId: string, input: UpdateOperationInput): Promise<OperationSession>;
  deleteOperation(operationId: string, deletedBy?: string): Promise<void>;
  getSummary(): Promise<OperationSummary>;
}
