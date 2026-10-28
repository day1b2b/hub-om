// 개인정보 "단일 필드 열람"(마스킹→클릭 열람)의 공용 진입점.
// 권한(워크스페이스 로그인)은 라우트에서 확인하고, 여기서는 (1) 필드 화이트리스트 검증 (2) 감사 로그
// 기록 (3) 그 필드 1개만 복호화해 반환한다. 대량 export(admin 전용, coachPrivateAccess)와 달리
// 한 번에 한 필드만, 누가·언제·무엇을 열람했는지 남기며 연다(팀 결정: 워크스페이스 전원 + 감사).
import type { CoachPrivateProfileView } from "./coachTypes";
import type { InstructorPrivateProfileView } from "./instructorPrivateRepository";
import { getCoachPrivateRepository } from "./coachPrivateRepositoryFactory";
import { getInstructorPrivateRepository } from "./instructorPrivateRepositoryFactory";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";

export type PiiEntity = "coach" | "instructor";

// 당사자 PII 필드만 허용(연결 키·토큰 등 시스템 필드 차단). 엔티티가 늘면 여기에 추가.
const REVEALABLE_FIELDS: Record<PiiEntity, readonly string[]> = {
  coach: ["employeeId", "phone", "email", "birthDate", "affiliation"],
  instructor: ["contact", "contact2", "email", "email2", "birthDate"]
};

/** entity·field가 열람 허용 목록에 있는지 검증(라우트 입력은 신뢰하지 않는다). */
export function isRevealableField(entity: unknown, field: unknown): entity is PiiEntity {
  if (typeof entity !== "string" || typeof field !== "string") return false;
  const fields = REVEALABLE_FIELDS[entity as PiiEntity];
  return Boolean(fields) && fields.includes(field);
}

/** 열람 시도를 감사 로그에 남긴다(조회 성공 여부와 무관, 복호화 전에 먼저). */
async function recordReveal(entity: PiiEntity, id: string, field: string, accessedByEmail: string): Promise<void> {
  if (entity === "coach") {
    // 코치는 기존 감사 테이블(coach_private_access_logs) 재사용. context에 열람한 필드를 남긴다.
    const override = getDataRepositoryOverride("coachPrivateAccessLog");
    if (override) {
      await override.recordAccess(id, accessedByEmail, field);
      return;
    }
    const prisma = getPrismaClient();
    await prisma.coachPrivateAccessLog.create({ data: { accessedByEmail, coachId: id, context: field } });
    return;
  }
  // 강사는 전용 감사 테이블(instructor_private_access_logs)에 기록(현재 postgres — mongo override 미연동).
  const prisma = getPrismaClient();
  await prisma.instructorPrivateAccessLog.create({ data: { accessedByEmail, context: field, instructorNoteId: id } });
}

/**
 * PII 필드 1개를 열람한다. 호출 전 라우트에서 워크스페이스 세션을 확인해야 한다.
 * 감사 로그를 먼저 남기고, 그 필드만 복호화해 반환한다(암호화 저장소에서 select → 투명 복호화). 값 없으면 null.
 */
export async function revealPiiField(
  entity: PiiEntity,
  id: string,
  field: string,
  accessedByEmail: string
): Promise<string | null> {
  await recordReveal(entity, id, field, accessedByEmail);
  if (entity === "coach") {
    const profile = await getCoachPrivateRepository().getPrivateProfile(id);
    if (!profile) return null;
    const value = profile[field as keyof CoachPrivateProfileView];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  const profile = await getInstructorPrivateRepository().getPrivateProfile(id);
  if (!profile) return null;
  const value = profile[field as keyof InstructorPrivateProfileView];
  return typeof value === "string" && value.length > 0 ? value : null;
}
