import type { Prisma } from "@prisma/client";

/**
 * 코치 일정 화면의 "예약(선점)" 표시는 실제 투입이 확정되면 더 이상 필요 없다.
 * 같은 코치·날짜로 실제 투입 일정(CoachEngagementSchedule)이 반영되면
 * 남아있는 예약을 자동으로 취소하고, 어떤 확정 건(engagement)으로 이어졌는지
 * confirmedEngagementId에 남겨 마이페이지의 "확정된 과정" 목록에서 보여준다.
 */
export async function cancelReservationsForConfirmedSchedules(
  tx: Prisma.TransactionClient,
  entries: Array<{ coachId: string; date: Date; engagementId: string }>
): Promise<void> {
  if (entries.length === 0) return;

  const entriesByEngagement = new Map<string, Array<{ coachId: string; date: Date }>>();
  for (const entry of entries) {
    const group = entriesByEngagement.get(entry.engagementId) ?? [];
    group.push({ coachId: entry.coachId, date: entry.date });
    entriesByEngagement.set(entry.engagementId, group);
  }

  for (const [engagementId, group] of entriesByEngagement) {
    await tx.coachDayReservation.updateMany({
      where: {
        cancelledAt: null,
        OR: group.map((entry) => ({ coachId: entry.coachId, date: entry.date }))
      },
      data: { cancelledAt: new Date(), confirmedEngagementId: engagementId }
    });
  }
}
