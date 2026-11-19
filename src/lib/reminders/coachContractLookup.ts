// P2 코치 투입 확인 알림용: 회차(운영현황) 중 '계약시트 코치 계약(source=SHEET, 취소 아님)'이 연결된
// 회차를 찾는 포트. 키는 운영현황 업무 operationId(CoachEngagement.operationSession.operationId)로,
// 알람봇의 operation.operationId와 바로 맞물린다. 읽기 실패는 알림 누락일 뿐 전체 알림을 막지 않도록
// 빈 집합으로 degrade한다(코치 계약이 '확실히 있는' 회차만 알린다는 보수적 기본값).
import { getPrismaClient } from "@/lib/data/prisma";

export interface LectureFollowUpCoachContracts {
  /** 주어진 operationId들 중, 연결된 SHEET 코치 계약(취소 아님)이 있는 operationId 집합. */
  sessionsWithContract(operationIds: string[]): Promise<Set<string>>;
}

export const defaultCoachContracts: LectureFollowUpCoachContracts = {
  async sessionsWithContract(operationIds) {
    if (operationIds.length === 0) return new Set();
    try {
      const rows = await getPrismaClient().coachEngagement.findMany({
        where: {
          source: "SHEET",
          status: { not: "CANCELLED" },
          operationSession: { operationId: { in: operationIds } }
        },
        select: { operationSession: { select: { operationId: true } } }
      });
      const found = new Set<string>();
      for (const row of rows) if (row.operationSession?.operationId) found.add(row.operationSession.operationId);
      return found;
    } catch {
      console.error("[reminder] 코치 계약 조회 실패 — 코치 투입 확인 알림을 이번 실행에서 건너뜁니다");
      return new Set();
    }
  }
};
