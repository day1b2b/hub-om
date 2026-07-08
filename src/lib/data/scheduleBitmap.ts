const SLOT_START_HOUR = 7;
const SLOT_COUNT = 30;

export const SCHEDULE_SLOTS = Array.from({ length: SLOT_COUNT }, (_, index) => {
  const hour = Math.floor(index / 2) + SLOT_START_HOUR;
  const minute = (index % 2) * 30;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

export interface TimeInterval {
  startTime: string;
  endTime: string;
}

export function toBitmap(intervals: TimeInterval[]): boolean[] {
  const bitmap = new Array<boolean>(SLOT_COUNT).fill(false);
  for (const { startTime, endTime } of intervals) {
    const startIndex = slotIndex(startTime);
    const endIndex = slotIndex(endTime);
    if (startIndex < 0 || endIndex < 0) continue;
    for (let index = startIndex; index < endIndex; index += 1) {
      bitmap[index] = true;
    }
  }
  return bitmap;
}

export function subtractBitmap(available: boolean[], busy: boolean[]): boolean[] {
  return available.map((value, index) => value && !busy[index]);
}

export function clearOverlappingPeriods(remaining: boolean[], busy: boolean[]): boolean[] {
  const result = [...remaining];
  const periods = [
    [2, 12],
    [12, 22],
    [22, 30]
  ];

  for (const [start, end] of periods) {
    const hasBusy = busy.slice(start, end).some(Boolean);
    if (!hasBusy) continue;
    for (let index = start; index < end; index += 1) {
      result[index] = false;
    }
  }

  return result;
}

export function hasAvailability(bitmap: boolean[]): boolean {
  return bitmap.some(Boolean);
}

export function toIntervals(bitmap: boolean[]): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  let start: number | null = null;

  for (let index = 0; index <= bitmap.length; index += 1) {
    if (index < bitmap.length && bitmap[index]) {
      start ??= index;
      continue;
    }

    if (start !== null) {
      intervals.push({
        startTime: SCHEDULE_SLOTS[start],
        endTime: index < SCHEDULE_SLOTS.length ? SCHEDULE_SLOTS[index] : "22:00"
      });
      start = null;
    }
  }

  return intervals;
}

function slotIndex(time: string): number {
  const [hourRaw, minuteRaw] = time.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;

  const index = (hour - SLOT_START_HOUR) * 2 + (minute >= 30 ? 1 : 0);
  return index < 0 || index > SLOT_COUNT ? -1 : index;
}
