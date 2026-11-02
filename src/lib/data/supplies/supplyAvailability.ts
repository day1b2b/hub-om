import { isValidDate, kstToday } from "@/lib/data/eggs/eggAvailability";
import type { SupplyAvailability, SupplyRentalRecord } from "./supplyTypes";

/**
 * 운영물품 가용성 계산 (순수 함수). 날짜는 에그와 같이 "YYYY-MM-DD" 문자열로 비교한다.
 * 한 대여가 여러 물품을 잡을 수 있어서, 물품별로 볼 때는 itemIds에 그 물품이 들어 있는 대여만 본다.
 */

function openRentals(rentals: SupplyRentalRecord[], itemId: string): SupplyRentalRecord[] {
  return rentals.filter(
    (rental) =>
      rental.itemIds.includes(itemId) &&
      !rental.returned &&
      isValidDate(rental.startDate) &&
      isValidDate(rental.returnDueDate)
  );
}

export function getActiveSupplyRental(
  rentals: SupplyRentalRecord[],
  itemId: string,
  today: string = kstToday()
): SupplyRentalRecord | null {
  return (
    openRentals(rentals, itemId).find((rental) => rental.startDate <= today && today <= rental.returnDueDate) ?? null
  );
}

export function getOverdueSupplyRental(
  rentals: SupplyRentalRecord[],
  itemId: string,
  today: string = kstToday()
): SupplyRentalRecord | null {
  const overdue = openRentals(rentals, itemId)
    .filter((rental) => rental.returnDueDate < today)
    .sort((a, b) => a.returnDueDate.localeCompare(b.returnDueDate));
  return overdue[0] ?? null;
}

export function getNextSupplyRental(
  rentals: SupplyRentalRecord[],
  itemId: string,
  today: string = kstToday()
): SupplyRentalRecord | null {
  const upcoming = openRentals(rentals, itemId)
    .filter((rental) => rental.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] ?? null;
}

export function getSupplyAvailability(
  rentals: SupplyRentalRecord[],
  itemId: string,
  today: string = kstToday()
): SupplyAvailability {
  if (getActiveSupplyRental(rentals, itemId, today)) return "rented";
  if (getOverdueSupplyRental(rentals, itemId, today)) return "overdue";
  if (getNextSupplyRental(rentals, itemId, today)) return "reserved";
  return "available";
}

/** 요청 기간과 하루라도 겹치는 미반납 대여. 고른 물품 중 하나라도 겹치면 포함한다. */
export function getSupplyConflicts(
  rentals: SupplyRentalRecord[],
  itemIds: string[],
  start: string,
  end: string
): SupplyRentalRecord[] {
  if (!isValidDate(start) || !isValidDate(end) || start > end) return [];
  const conflicts = new Map<string, SupplyRentalRecord>();
  for (const itemId of itemIds) {
    for (const rental of openRentals(rentals, itemId)) {
      if (start <= rental.returnDueDate && end >= rental.startDate) conflicts.set(rental.id, rental);
    }
  }
  return Array.from(conflicts.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
}
