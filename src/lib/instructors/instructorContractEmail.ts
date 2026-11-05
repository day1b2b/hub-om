// 강사 계약요청 확인 창을 열 때 그 강사 1명의 이메일을 노션 강사 정보(hub 암호화 저장본)에서 읽기 위한
// "운영 현황 강사 표기 → 노션 강사 노트 id" 해석. 순수 함수(I/O 없음).
// 틀린 사람의 이메일을 프리필하느니 비우는 편이 안전하므로, 한 명으로 확정될 때만 id를 돌려준다
// (동명이인·못 찾음 = null → 확인 창은 "비어 있음 · 폼에서 입력").
import type { InstructorNote } from "@/lib/data/instructorNoteRepository";
import { normalizeInstructorName } from "./instructorContractMatch";
import type { InstructorContractRecord } from "./instructorContractSheet";
import { parseSheetTimestamp } from "./instructorContractSigning";

export const CONTRACT_REQUEST_CONTEXT = "contract_request";

/**
 * notes: 강사 노트 전체, linkTargets: OM이 위키에서 지정한 수동 연결(운영 현황 표기 → 노션 강사명).
 * ① 수동 연결이 있으면 그 노션 강사명으로 ② 이름이 정확히 같은 노션 강사 ③ 소속 접두사 등을 뗀 정규화 이름이
 *    같은 노션 강사 — 각 단계에서 후보가 딱 1명일 때만 확정한다.
 */
export function resolveContractInstructorNoteId(
  notes: readonly InstructorNote[],
  linkTargets: Readonly<Record<string, string>>,
  instructorName: string
): string | null {
  const raw = instructorName.trim();
  if (!raw) return null;
  const notionNotes = notes.filter((note) => note.notionNo !== undefined && note.id && (note.instructorName ?? "").trim());
  const target = linkTargets[raw] ?? raw;

  const exact = notionNotes.filter((note) => (note.instructorName ?? "").trim() === target);
  if (exact.length === 1) return exact[0].id ?? null;
  if (exact.length > 1) return null;

  const normalized = normalizeInstructorName(target);
  if (!normalized) return null;
  const loose = notionNotes.filter((note) => normalizeInstructorName(note.instructorName ?? "") === normalized);
  return loose.length === 1 ? (loose[0].id ?? null) : null;
}

// ── 강사료 참고값 ──────────────────────────────────────────────────────────────
// 폼의 "시간당 강사료"는 과정마다 협의라 자동 입력하지 않는다(2026-11-05 대조: 노션 기본 강사료 = 직전 계약 69%,
// 같은 강사도 계약의 65%에서 금액이 바뀜). 확인 창에 판단 근거로만 보여 준다.

export interface ContractFeeHint {
  /** 계약 시트에서 이 강사의 가장 최근 계약 시간당 강사료(원)와 그 계약 월("2026.10"). */
  lastContract?: { amount: number; month: string };
  /** 노션 강사 DB "기본 강사료"(원). 단위·부가세 기준이 섞여 있어 참고용. */
  notionBase?: number;
}

/** 시트 U열 자유 입력("250,000", "25만원", "250,000(부가세 별도)") → 원. 못 읽으면 null. */
export function parseHourlyFee(value: string | undefined): number | null {
  const text = (value ?? "").replace(/\s/g, "");
  if (!text) return null;
  const man = text.match(/([\d,.]+)만/);
  if (man) {
    const amount = Math.round(Number.parseFloat(man[1].replace(/,/g, "")) * 10000);
    return amount > 0 ? amount : null;
  }
  const digits = text.match(/[\d,]+/);
  if (!digits) return null;
  const amount = Number(digits[0].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * 이 강사(정규화 이름)의 가장 최근 계약 강사료. 시트에 같은 이름으로 서로 다른 이메일이 2개 이상이면
 * 동명이인일 수 있어 보여 주지 않는다(틀린 사람 금액을 근거로 내밀지 않음).
 */
export function findLastContractFee(
  records: readonly InstructorContractRecord[],
  instructorName: string
): ContractFeeHint["lastContract"] {
  const normalized = normalizeInstructorName(instructorName);
  if (!normalized) return undefined;
  const mine = records.filter((record) => normalizeInstructorName(record.instructorName) === normalized);
  const emails = new Set(mine.map((record) => record.email.trim().toLowerCase()).filter(Boolean));
  if (emails.size > 1) return undefined;
  let best: { amount: number; at: number } | null = null;
  for (const record of mine) {
    const amount = parseHourlyFee(record.hourlyFee);
    const at = parseSheetTimestamp(record.requestedAt);
    if (amount === null || at === null) continue;
    if (!best || at >= best.at) best = { amount, at };
  }
  if (!best) return undefined;
  const month = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", timeZone: "Asia/Seoul", year: "numeric" })
    .formatToParts(new Date(best.at))
    .filter((part) => part.type === "year" || part.type === "month")
    .map((part) => part.value)
    .join(".");
  return { amount: best.amount, month };
}

/** 노션 "기본 강사료" — 비정상값(1,000원 미만, 예: 2.25)은 버린다. */
export function notionBaseFee(note: InstructorNote | undefined): number | undefined {
  const fee = note?.notion?.baseFee;
  return typeof fee === "number" && fee >= 1000 ? fee : undefined;
}
