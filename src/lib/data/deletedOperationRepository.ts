export interface DeletedOperationRow {
  operationId: string;
  companyName: string;
  courseName: string;
  roundNo: string | null;
  startDate: string;
  endDate: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

/** Storage selection never grants the administrator permission required by the API. */
export interface DeletedOperationRepository {
  listDeletedOperations(): Promise<DeletedOperationRow[]>;
  /** Existing live rows are updated too; missing IDs reject, and IDs are exact strings. */
  restoreOperation(operationId: string): Promise<{ operationId: string }>;
}
