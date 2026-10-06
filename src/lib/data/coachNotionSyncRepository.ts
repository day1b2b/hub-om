import type { JsonObject } from "../coaches/notionCoachMap";

export interface NotionSyncPrivateProfile {
  employeeId: string | null;
  phone: string | null;
  email: string | null;
  birthDate: Date | null;
  affiliation: string | null;
}
export interface NotionSyncPublicFields {
  employeeNo: string | null;
  notionNo: number | null;
  notionPageId: string | null;
  workType: string | null;
  portfolioUrl: string | null;
  selfNote: string | null;
  availabilityDetail: string | null;
}
export interface NotionSyncCoach extends NotionSyncPublicFields {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: Date;
  privateProfile: NotionSyncPrivateProfile | null;
  fields: string[];
  curriculums: string[];
}
export interface NotionSyncCoachCreate extends Partial<NotionSyncPublicFields> {
  id: string;
  sourceCoachId: string;
  accessToken: string;
  name: string;
  normalizedName: string;
}
export interface CoachNotionSyncReader {
  /** Includes soft-deleted coaches; matching never revives them. */
  findByNotionNo(notionNo: number): Promise<NotionSyncCoach | null>;
  /** Includes soft-deleted coaches, ordered by createdAt ascending. */
  listByNormalizedName(normalizedName: string): Promise<NotionSyncCoach[]>;
}
export interface CoachNotionSyncTransaction extends CoachNotionSyncReader {
  lockCoaches(coachIds: string[]): Promise<void>;
  createCoach(input: NotionSyncCoachCreate): Promise<void>;
  patchCoach(coachId: string, patch: Partial<NotionSyncPublicFields>): Promise<void>;
  upsertPrivateProfile(coachId: string, create: NotionSyncPrivateProfile, patch: Partial<Omit<NotionSyncPrivateProfile, "employeeId">>): Promise<void>;
  replaceTags(coachId: string, kind: "fields" | "curriculums", names: string[]): Promise<void>;
}
export interface CoachNotionSyncRepository extends CoachNotionSyncReader {
  /** Acquires catalog guard before invoking work; each source row is one transaction. */
  transaction<T>(work: (tx: CoachNotionSyncTransaction) => Promise<T>): Promise<T>;
}
export interface CoachNotionSource { readPages(): Promise<JsonObject[]> }
