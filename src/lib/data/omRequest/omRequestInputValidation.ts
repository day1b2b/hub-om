import { companyNameError } from "../companyName";
import type { OmRequestInput } from "./omRequestTypes";

/** Server-side minimum for a new request. The form checks more, but the API must not save an empty request. */
export function omRequestInputError(body: unknown): string | null {
  if (!body || typeof body !== "object") return "요청 내용을 확인해주세요.";
  const input = body as Partial<OmRequestInput>;
  const missing = ([["team", "구분"], ["ld", "LD"], ["company", "기업명"], ["courseName", "과정명"]] as const)
    .filter(([key]) => typeof input[key] !== "string" || !(input[key] as string).trim())
    .map(([, label]) => label);
  if (missing.length) return `${missing.join(", ")}을(를) 입력해주세요.`;
  const companyError = companyNameError(input.company);
  if (companyError) return companyError;
  if (!Array.isArray(input.sessions) || input.sessions.length === 0) return "교육 일정을 1회차 이상 입력해주세요.";
  const emptyRow = input.sessions.findIndex(session => !session || typeof session !== "object"
    || !((typeof session.date === "string" && session.date.trim()) || (typeof session.educationDatesText === "string" && session.educationDatesText.trim())));
  if (emptyRow >= 0) return `${emptyRow + 1}회차 교육일을 입력해주세요.`;
  return null;
}
