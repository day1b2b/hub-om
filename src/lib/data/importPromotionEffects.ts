import { getDataRepositoryOverride } from "./dataRepositoryContext";

export interface ImportPromotionCalendar {
  assertReady?(): void;
  backfillMissingCalendarEvents(options: { dryRun: false }): Promise<{
    totals: { insertedEvents: number; failedOperations: number };
  }>;
}

export function getImportPromotionCalendar(): ImportPromotionCalendar {
  const override = getDataRepositoryOverride("importPromotionCalendar");
  if (override) { override.assertReady?.(); return override; }
  return {
    async backfillMissingCalendarEvents(options) {
      const { backfillMissingCalendarEvents } = await import("../googleCalendar/backfillCalendarEvents");
      return backfillMissingCalendarEvents(options);
    }
  };
}
