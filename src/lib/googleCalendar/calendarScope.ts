import { getDataRepositoryOverride } from "../data/dataRepositoryContext";

/** Synchronous primary-path preflight before disabled checks or external reads. */
export function assertCalendarScopeReady(): void {
  if (!getDataRepositoryOverride("calendarPersistence")) return; // Default PG.
  getDataRepositoryOverride("calendarLock");
  getDataRepositoryOverride("operations");
  getDataRepositoryOverride("teamUsers");
}
