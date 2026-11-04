import { SupplyRentalBoard } from "@/features/supplies/SupplyRentalBoard";
import { requireSupplyPageSession } from "@/lib/auth/requireSupplySession";
import { addDays, kstToday } from "@/lib/data/eggs/eggAvailability";
import { getSupplyRepository } from "@/lib/data/supplies/prismaSupplyRepository";
import type { SupplyItemSummary, SupplyRentalRecord } from "@/lib/data/supplies/supplyTypes";

export const dynamic = "force-dynamic";

/** 반납이 끝난 대여는 최근 1주일치만 보여준다 */
const HISTORY_WINDOW_DAYS = 7;

export default async function MicsPage() {
  const session = await requireSupplyPageSession();
  const today = kstToday();

  let items: SupplyItemSummary[] = [];
  let rentals: SupplyRentalRecord[] = [];
  let loadFailed = false;

  try {
    const repository = getSupplyRepository();
    [items, rentals] = await Promise.all([
      repository.listItems("mic"),
      repository.listRentals("mic", { fromDate: addDays(today, -HISTORY_WINDOW_DAYS) })
    ]);
  } catch (error) {
    console.error("[mics] 마이크 대여 데이터를 불러오지 못했습니다.", error);
    loadFailed = true;
  }

  return (
    <SupplyRentalBoard
      category="mic"
      items={items}
      rentals={rentals}
      today={today}
      currentUserName={session.user?.name ?? ""}
      loadFailed={loadFailed}
    />
  );
}
