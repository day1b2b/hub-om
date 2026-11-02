import type { EggAvailability, EggDeviceSummary, EggRentalRecord } from "./eggTypes";

/**
 * 에그 대여 가용성 계산 (순수 함수).
 *
 * 날짜는 "YYYY-MM-DD" 문자열로만 비교한다. 이 형식은 사전순 비교가 곧 날짜순 비교라서
 * Date 객체를 쓸 때 생기는 시간대 하루 밀림 문제가 없다.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string | null | undefined): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

/** KST(UTC+9) 기준 오늘 날짜 */
export function kstToday(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** "2026.05.06", "2026. 5. 6", "2026-05-06" 등을 "2026-05-06"으로 정리 */
export function normalizeDate(value: string): string | null {
  const parts = value.trim().replace(/[.\s]+/g, "-").replace(/-+$/, "").split("-");
  if (parts.length < 3) return null;
  const [year, month, day] = parts;
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * 데이터 소진 표시는 매월 1일에 자동으로 풀린다.
 * 별도 스케줄러를 두지 않고, 표시한 달과 오늘의 달이 다르면 무효로 본다.
 */
export function isDataExhaustedNow(device: EggDeviceSummary, today: string = kstToday()): boolean {
  if (!device.dataExhausted) return false;
  if (!device.dataExhaustedAt) return true;
  return device.dataExhaustedAt.slice(0, 7) === today.slice(0, 7);
}

/** 반납되지 않은 대여만 자리를 차지한다 */
function openRentals(rentals: EggRentalRecord[], deviceId: string): EggRentalRecord[] {
  return rentals.filter(
    (rental) =>
      rental.eggDeviceId === deviceId &&
      !rental.returned &&
      isValidDate(rental.startDate) &&
      isValidDate(rental.returnDueDate)
  );
}

export function getActiveRental(
  rentals: EggRentalRecord[],
  deviceId: string,
  today: string = kstToday()
): EggRentalRecord | null {
  const active = openRentals(rentals, deviceId).find(
    (rental) => rental.startDate <= today && today <= rental.returnDueDate
  );
  return active ?? null;
}

/** 반납 예정일이 지났는데 아직 반납 처리되지 않은 대여 */
export function getOverdueRental(
  rentals: EggRentalRecord[],
  deviceId: string,
  today: string = kstToday()
): EggRentalRecord | null {
  const overdue = openRentals(rentals, deviceId)
    .filter((rental) => rental.returnDueDate < today)
    .sort((a, b) => a.returnDueDate.localeCompare(b.returnDueDate));
  return overdue[0] ?? null;
}

export function getNextRental(
  rentals: EggRentalRecord[],
  deviceId: string,
  today: string = kstToday()
): EggRentalRecord | null {
  const upcoming = openRentals(rentals, deviceId)
    .filter((rental) => rental.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] ?? null;
}

export function getDeviceAvailability(
  device: EggDeviceSummary,
  rentals: EggRentalRecord[],
  today: string = kstToday()
): EggAvailability {
  if (isDataExhaustedNow(device, today)) return "data_exhausted";
  if (getActiveRental(rentals, device.id, today)) return "rented";
  if (getOverdueRental(rentals, device.id, today)) return "overdue";
  if (getNextRental(rentals, device.id, today)) return "reserved";
  return "available";
}

/** 요청 기간과 하루라도 겹치는 미반납 대여 목록. 비어 있으면 그 기간에 빌릴 수 있다. */
export function getConflicts(
  rentals: EggRentalRecord[],
  deviceId: string,
  start: string,
  end: string
): EggRentalRecord[] {
  if (!isValidDate(start) || !isValidDate(end) || start > end) return [];
  return openRentals(rentals, deviceId)
    .filter((rental) => start <= rental.returnDueDate && end >= rental.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export interface EggDateRange {
  from: string;
  to: string;
}

/** 요청 기간 중 아직 비어 있는 구간. 전부 비면 요청 기간 전체 1건, 전부 차면 빈 배열. */
export function getFreeRanges(
  conflicts: EggRentalRecord[],
  start: string,
  end: string
): EggDateRange[] {
  if (!isValidDate(start) || !isValidDate(end) || start > end) return [];

  const ranges: EggDateRange[] = [];
  let openFrom: string | null = null;
  let previous: string | null = null;

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const occupied = conflicts.some(
      (rental) => rental.startDate <= cursor && cursor <= rental.returnDueDate
    );

    if (!occupied) {
      if (!openFrom) openFrom = cursor;
      previous = cursor;
      continue;
    }

    if (openFrom && previous) {
      ranges.push({ from: openFrom, to: previous });
      openFrom = null;
      previous = null;
    }
  }

  if (openFrom && previous) ranges.push({ from: openFrom, to: previous });
  return ranges;
}

export type EggSearchOutcome = "free" | "partial" | "full";

export interface EggSearchResult {
  device: EggDeviceSummary;
  outcome: EggSearchOutcome;
  conflicts: EggRentalRecord[];
  freeRanges: EggDateRange[];
  dataExhausted: boolean;
}

/** 기간을 입력했을 때 기기별 예약 가능 여부를 한 번에 계산한다 */
export function searchAvailability(
  devices: EggDeviceSummary[],
  rentals: EggRentalRecord[],
  start: string,
  end: string,
  today: string = kstToday()
): EggSearchResult[] {
  return devices.map((device) => {
    const conflicts = getConflicts(rentals, device.id, start, end);
    const freeRanges = getFreeRanges(conflicts, start, end);
    const fullyFree = conflicts.length === 0;
    const outcome: EggSearchOutcome = fullyFree ? "free" : freeRanges.length > 0 ? "partial" : "full";

    return {
      device,
      outcome,
      conflicts,
      freeRanges,
      dataExhausted: isDataExhaustedNow(device, today)
    };
  });
}

const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-07-29 (수)" 형태로 표시 */
export function formatDateWithWeekday(date: string): string {
  if (!isValidDate(date)) return date;
  const [year, month, day] = date.split("-").map(Number);
  const weekday = KOREAN_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${date} (${weekday})`;
}

/** 상세 내역에 보여줄 대여: 지난 것은 직전 1건만, 오늘 이후·미반납은 전부 */
export function getVisibleRentals(
  rentals: EggRentalRecord[],
  deviceId: string,
  today: string = kstToday()
): EggRentalRecord[] {
  const own = rentals
    .filter((rental) => rental.eggDeviceId === deviceId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = own.filter((rental) => rental.returned && rental.returnDueDate < today);
  const current = own.filter((rental) => !(rental.returned && rental.returnDueDate < today));
  const lastPast = past.slice(-1);
  return [...lastPast, ...current];
}
