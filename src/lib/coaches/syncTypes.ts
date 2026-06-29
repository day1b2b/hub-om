export interface SyncChange {
  coachName: string;
  courseName?: string;
  action: string;
  details?: string;
}

export interface SyncResult {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetail: string[];
  changes?: SyncChange[];
}

export function emptySyncResult(dryRun = false): SyncResult {
  return {
    totalRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    errorDetail: [],
    changes: dryRun ? [] : undefined
  };
}
