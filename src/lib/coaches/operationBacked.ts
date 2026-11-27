// 투입이 운영현황(실습코치 coachText) 출신인지 판정한다. 순수 함수(I/O 없음).
//
// 운영현황 회차 동기화(sessionCoachSync)가 만든 MANUAL 투입만 sourceEngagementId에
// "manual-session:<회차>:<코치>" 형태를 쓴다. 계약시트·삼성 스케줄시트 등 보조 소스에서 들어온
// 투입은 다른 형태(UUID 등)를 쓰므로, 이 접두사로 "운영현황에 이 코치가 있는 투입"만 가린다.
export const OPERATION_BACKED_PREFIX = "manual-session:";

/** sourceEngagementId가 운영현황 회차 동기화 산출물인가(= 운영현황 정본 투입). */
export function isOperationBackedSourceId(sourceEngagementId: string | null | undefined): boolean {
  return typeof sourceEngagementId === "string" && sourceEngagementId.startsWith(OPERATION_BACKED_PREFIX);
}
