import { getDataRepositoryOverride } from "./dataRepositoryContext";

export interface ImportPromotionCalendar {
  backfillMissingCalendarEvents(options: { dryRun: false }): Promise<{
    totals: { insertedEvents: number; failedOperations: number };
  }>;
}

export function getImportPromotionCalendar(): ImportPromotionCalendar {
  return getDataRepositoryOverride("importPromotionCalendar") ?? {
    async backfillMissingCalendarEvents(options) {
      const { backfillMissingCalendarEvents } = await import("../googleCalendar/backfillCalendarEvents");
      return backfillMissingCalendarEvents(options);
    }
  };
}
