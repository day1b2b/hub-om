import { assertCoachPiiAccess } from "@/lib/auth/requireAdminSession";
import type { CoachEngagementFeedbackView, CoachPrivateProfileView } from "./coachTypes";
import { getCoachPrivateRepository } from "./coachPrivateRepositoryFactory";
import { getPrismaClient } from "./prisma";

/**
 * 코치 민감정보(PII) 접근의 단일 진입점.
 *
 * 민감정보는 반드시 이 경로로만 조회한다. private repository를 직접 호출하지 말 것.
 * 각 조회는 (1) assertAdminSession으로 admin 권한을 강제하고
 * (2) coach_private_access_logs에 접근 기록을 남긴 뒤 (3) 결과를 반환한다.
 *
 * 민감정보 대량 export는 제공하지 않는다(YAGNI).
 * 향후 추가 시에도 admin 권한 + 접근 감사(audit) + rate-limit를 전제로 한다.
 */

async function recordPrivateAccess(
  coachId: string,
  accessedByEmail: string,
  context: string
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.coachPrivateAccessLog.create({
    data: { coachId, accessedByEmail, context }
  });
}

export async function readCoachPrivateProfile(
  coachId: string,
  context: string
): Promise<CoachPrivateProfileView | null> {
  const session = await assertCoachPiiAccess();
  // 권한 확인 통과 시점에 접근 시도 자체를 감사한다(조회 성공 여부와 무관).
  await recordPrivateAccess(coachId, session.user!.email!, context);

  return getCoachPrivateRepository().getPrivateProfile(coachId);
}

export async function readCoachEngagementFeedback(
  coachId: string,
  context: string
): Promise<CoachEngagementFeedbackView[]> {
  const session = await assertCoachPiiAccess();
  // 권한 확인 통과 시점에 접근 시도 자체를 감사한다(조회 성공 여부와 무관).
  await recordPrivateAccess(coachId, session.user!.email!, context);

  return getCoachPrivateRepository().getEngagementFeedback(coachId);
}
