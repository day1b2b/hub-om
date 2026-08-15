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

export function parsePastedRounds(value: string): ParsedRound[] {
  return value
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0)
    .map((line) => toParsedRound(line));
}

function toParsedRound(line: string): ParsedRound {
  const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((cell) => cell.trim());
  const [roundNoCell = "", startDateCell = "", endDateCell = "", timeTextCell = "", instructorsCell = "", coachCell = ""] =
    cells;

  const roundNo = roundNoCell.trim();
  const startDate = normalizeDateCell(startDateCell);
  const endDate = normalizeDateCell(endDateCell);
  const errors: string[] = [];

  if (!roundNo) errors.push("회차 필요");
  if (!startDate) errors.push("시작일 확인 필요");
  if (!endDate) errors.push("종료일 확인 필요");

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
    timeText: timeTextCell.trim()
  };
}

function normalizeDateCell(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/.exec(trimmed);

  if (!match) return "";

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
