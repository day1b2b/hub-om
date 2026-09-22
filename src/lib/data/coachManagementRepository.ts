/** DTO contract of the coach management HTTP API (distinct from schedule/dashboard DTOs). */
export interface CoachManagementTag { id: string; name: string }
export interface CoachManagementSummary {
  id: string; name: string; workType: string | null; status: string; isActive: boolean;
  fields: CoachManagementTag[]; curriculums: CoachManagementTag[];
  engagementCount: number; latestEngagement: { courseName: string; endDate: string } | null;
}
export interface CoachManagementDetail {
  id: string; name: string; workType: string | null; status: string; statusNote: string | null;
  returnDate: string | null; selfNote: string | null; portfolioUrl: string | null;
  availabilityDetail: string | null; managerNote: string | null; dxTag: string | null; isActive: boolean;
  fields: CoachManagementTag[]; curriculums: CoachManagementTag[]; engagementCount: number; scheduleCount: number;
}
export interface CoachManagementQuery { search?: string; field?: string; status?: string; page: number; limit: number }
export interface CoachManagementAuthor { email: string; name: string }
export interface CoachManagementRepository {
  listCoaches(query: CoachManagementQuery): Promise<{ coaches: CoachManagementSummary[]; total: number }>;
  getCoach(id: string): Promise<CoachManagementDetail | null>;
  createCoach(body: Record<string, unknown>): Promise<{ id: string; name: string }>;
  updateCoach(id: string, body: Record<string, unknown>, author: CoachManagementAuthor): Promise<{ id: string; name: string }>;
  updateCoachStatus(id: string, status: unknown): Promise<{ id: string; status: string; isActive: boolean }>;
  deleteCoach(id: string, deletedBy: string | null): Promise<void>;
}
export class CoachManagementError extends Error {
  readonly code: "COACH_NAME_REQUIRED" | "COACH_NOT_FOUND" | "INVALID_COACH_STATUS";
  constructor(code: CoachManagementError["code"]) { super(code); this.code = code; }
}
/** Only documented domain errors become HTTP responses; infrastructure failures propagate. */
export function coachManagementFailure(error: unknown): { status: number; error: string } | null {
  if (!(error instanceof Error) || !("code" in error)) return null;
  if (error.code === "COACH_NAME_REQUIRED") return { status: 400, error: "이름이 필요합니다." };
  if (error.code === "INVALID_COACH_STATUS") return { status: 400, error: "상태 값이 올바르지 않습니다." };
  if (error.code === "COACH_NOT_FOUND") return { status: 404, error: "코치를 찾을 수 없습니다." };
  return null;
}
