import type { DatabaseDashboardSnapshot } from "../admin/databaseDashboardPresenter";
import type { AdminDatabaseTableKey } from "../admin/databaseEditConfig";
export interface AdminDatabaseCellUpdate {
  field: string; rowId: string; table: AdminDatabaseTableKey;
  updatedBy: string | null; value: boolean | Date | number | string | null;
}
export interface AdminDatabaseRepository {
  readDashboard(): Promise<DatabaseDashboardSnapshot>;
  updateCell(input: AdminDatabaseCellUpdate): Promise<void>;
}
/** Safe adapter codes consumed by the existing route; never retain a driver cause. */
export class AdminDatabaseCellError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Admin database cell update failed: ${code}`); this.code = code; }
}
