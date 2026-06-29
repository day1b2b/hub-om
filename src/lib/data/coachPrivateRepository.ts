import type { CoachEngagementFeedbackView, CoachPrivateProfileView } from "./coachTypes";

/**
 * 민감(PII) 전용 repository. employeeId/phone/email/birthDate/affiliation,
 * engagement feedback/hiredByText 등 민감 데이터만 다룬다.
 * 권한 게이팅(requireAdminSession + audit)은 호출부 책임이다. (Phase 3에서 래핑)
 */
export interface CoachPrivateRepository {
  getPrivateProfile(coachId: string): Promise<CoachPrivateProfileView | null>;
  getEngagementFeedback(coachId: string): Promise<CoachEngagementFeedbackView[]>;
}
