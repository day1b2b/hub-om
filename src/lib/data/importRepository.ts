import type { ImportRunDetail, ImportRunSummary } from "./importTypes";

export interface ImportRepository {
  listImportRuns(): Promise<ImportRunSummary[]>;
  getImportRunById(id: string): Promise<ImportRunDetail | null>;
}
