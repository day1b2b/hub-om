import { getAdminDatabaseRepository } from "../data/adminDatabaseRepositoryFactory";
export type { DatabaseCellOption, DatabaseCellPreview, DatabaseRowPreview, DatabaseTableSnapshot, DatabaseDashboardSnapshot } from "./databaseDashboardPresenter";
export { DATABASE_TABLE_SAMPLE_LIMIT } from "./databaseDashboardPresenter";
export function readDatabaseDashboard() { return getAdminDatabaseRepository().readDashboard(); }
