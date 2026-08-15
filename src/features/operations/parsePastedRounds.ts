export interface ParsedRound {
  coach: string;
  endDate: string;
  errors: string[];
  instructors: string;
  raw: string;
  roundNo: string;
  startDate: string;
  status: "idle" | "saving" | "done" | "failed";
  statusMessage: string;
  timeText: string;
}

const TIME_RANGE_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)\s*~\s*([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeRangeText(value: string): boolean {
  return TIME_RANGE_PATTERN.test(value.trim());
}

/** 유효한 시간 범위 문자열을 "HH:MM ~ HH:MM" 형식으로 통일한다. 유효하지 않으면 원본 그대로 반환한다. */
export function normalizeTimeRangeText(value: string): string {
  const trimmed = value.trim();
  const match = TIME_RANGE_PATTERN.exec(trimmed);

  if (!match) return trimmed;

  const [, startHour, startMinute, endHour, endMinute] = match;
  return `${startHour.padStart(2, "0")}:${startMinute} ~ ${endHour.padStart(2, "0")}:${endMinute}`;
}

export function parsePastedRounds(value: string, existingRoundNumbers: number[] = []): ParsedRound[] {
  const rows = value
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0)
    .map((line) => toParsedRound(line));

  return applyRoundSequenceValidation(rows, existingRoundNumbers);
}

/**
 * 붙여넣은 순서대로 회차 번호가 1씩 증가하는지 확인하고, 끊긴 지점에만 오류를 추가한다.
 * existingRoundNumbers(과정에 이미 등록된 회차 번호)가 있으면, 이미 등록된 번호와 겹치는지를
 * 먼저 확인하고(중복이 연속성 오류보다 더 명확한 원인이므로 우선함), 그 마지막 번호를 기준으로
 * 첫 행부터 이어지는지도 함께 확인한다.
 */
function applyRoundSequenceValidation(rows: ParsedRound[], existingRoundNumbers: number[]): ParsedRound[] {
  const existingRoundNoSet = new Set(existingRoundNumbers);
  let previousRoundNo: number | null = existingRoundNumbers.length > 0 ? Math.max(...existingRoundNumbers) : null;

  return rows.map((row) => {
    const currentRoundNo = row.roundNo === "" ? NaN : Number(row.roundNo);

    if (!Number.isFinite(currentRoundNo)) return row;

    if (existingRoundNoSet.has(currentRoundNo)) {
      previousRoundNo = currentRoundNo;
      return { ...row, errors: [...row.errors, `이미 ${currentRoundNo}회차 정보가 등록되어 있음`] };
    }

    const expectedRoundNo = previousRoundNo === null ? null : previousRoundNo + 1;
    const isSequential = expectedRoundNo === null || currentRoundNo === expectedRoundNo;

    previousRoundNo = currentRoundNo;

    if (isSequential) return row;

    return {
      ...row,
      errors: [...row.errors, `회차가 연속되지 않음 (${expectedRoundNo}회차여야 함)`]
    };
  });
}

function toParsedRound(line: string): ParsedRound {
  const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((cell) => cell.trim());
  const [roundNoCell = "", startDateCell = "", endDateCell = "", timeTextCell = "", instructorsCell = "", coachCell = ""] =
    cells;

  const roundNo = roundNoCell.trim();
  const startDate = normalizeDateCell(startDateCell);
  const endDate = normalizeDateCell(endDateCell);
  const timeText = timeTextCell.trim();
  const errors: string[] = [];

  if (!roundNo) errors.push("회차 필요");
  if (!startDate) errors.push("시작일 확인 필요");
  if (!endDate) errors.push("종료일 확인 필요");
  if (timeText && !isValidTimeRangeText(timeText)) errors.push("시간 형식 확인 필요 (예: 09:30 ~ 17:30)");

  return {
    coach: coachCell.trim(),
    endDate,
    errors,
    instructors: instructorsCell.trim(),
    raw: line,
    roundNo,
    startDate,
    status: "idle",
    statusMessage: "",
    timeText: isValidTimeRangeText(timeText) ? normalizeTimeRangeText(timeText) : timeText
  };
}

function normalizeDateCell(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/.exec(trimmed);

  if (!match) return "";

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
