/** Internal storage contract. The caller must first pass assertCoachPiiAccess. */
export type CoachExportType = "phone" | "email" | "mail-merge";
export interface CoachExportRow {
  id: string;
  name: string;
  accessToken: string | null;
  privateProfile: { phone: string | null; email: string | null } | null;
}
export interface CoachExportRepository {
  exportCoaches(ids: string[], type: CoachExportType, actorEmail: string): Promise<CoachExportRow[]>;
}
