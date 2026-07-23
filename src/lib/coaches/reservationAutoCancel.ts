import type { Prisma } from "@prisma/client";

/**
 * 코치 일정 화면의 "예약(선점)" 표시는 실제 투입이 확정되면 더 이상 필요 없다.
 * 같은 코치·날짜로 실제 투입 일정(CoachEngagementSchedule)이 반영되면
 * 남아있는 예약을 자동으로 취소해, 예약 목록이 확정 건과 뒤섞이지 않게 한다.
 */
export async function cancelReservationsForConfirmedSchedules(
  tx: Prisma.TransactionClient,
  entries: Array<{ coachId: string; date: Date }>
): Promise<void> {
  if (entries.length === 0) return;

  await tx.coachDayReservation.updateMany({
    where: {
      cancelledAt: null,
      OR: entries.map((entry) => ({ coachId: entry.coachId, date: entry.date }))
    },
    data: { cancelledAt: new Date() }
  });
}
