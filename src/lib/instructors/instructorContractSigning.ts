// 모두싸인 문서 → 강사 계약(코스ID × 강사) 매칭과 서명 진행 요약. 순수 함수(I/O 없음).
// 시트 F열 "최종완료"는 발송 처리 완료라 서명 여부를 알 수 없다(2026-11-03 대조). 서명은 모두싸인만 안다.
//
// 매칭 키: 모두싸인 제목 앞 번호는 코스ID가 아니라서, 시트 행(코스ID × 강사)의
//   ① 강사 이메일(Q) = 서명자 중 EMAIL 서명 방식의 값 (없으면 제목에 강사명 포함으로 대신)
//   ② 요청 시각(AE) 하루 전 ~ 90일 뒤에 생성된 문서
//   ③ 후보가 여럿이면 제목에 코스명(K)이 들어간 것으로 좁힘
// 으로 찾는다. 같은 강사의 다른 계약 행과 후보가 겹쳐 가를 수 없으면 추측하지 않고 "확인 필요"로 둔다.
// 이메일은 비교에만 쓰고 결과(요약)에는 남기지 않는다.
import type { ModusignDocument, ModusignParticipant } from "@/lib/modusign/modusignClient";
import type { InstructorContractRecord } from "./instructorContractSheet";
import { normalizeInstructorName } from "./instructorContractMatch";

/** 서명 순서(1~4)에 붙는 역할. 회사 계약 양식 순서 = 담당 OM → 부서장 → 데이원컴퍼니 → 강사. */
const ROLE_BY_ORDER = ["OM", "부서장", "데이원", "강사"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_BEFORE_MS = DAY_MS;
const WINDOW_AFTER_MS = 90 * DAY_MS;

export type SigningPhase = "signing" | "completed" | "aborted" | "preparing" | "ambiguous";

export interface SigningStep {
  role: string;
  signed: boolean;
}

export interface SigningSummary {
  phase: SigningPhase;
  /** 서명 순서대로 역할·서명 여부. ambiguous면 빈 배열. */
  steps: SigningStep[];
  /** 지금 서명할 차례인 역할(signing일 때만). */
  currentRole?: string;
  /** 모두싸인 문서 마지막 변경 시각(원문). */
  updatedAt?: string;
}

/** 시트 타임스탬프("2026. 11. 3 오후 2:04:16", KST) → epoch ms. 형식이 다르면 null. */
export function parseSheetTimestamp(value: string | undefined): number | null {
  const match = (value ?? "").trim().match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, meridiem, hourText, minute, second] = match;
  let hour = Number(hourText);
  if (meridiem === "오후" && hour < 12) hour += 12;
  if (meridiem === "오전" && hour === 12) hour = 0;
  const pad = (n: number | string) => String(n).padStart(2, "0");
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}:${second ?? "00"}+09:00`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/** 제목 비교용: 공백 제거 + 소문자. */
function compact(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function signers(document: ModusignDocument): ModusignParticipant[] {
  return (document.participants ?? [])
    .filter((participant) => participant.type === "SIGNER")
    .sort((a, b) => (a.signingOrder ?? 0) - (b.signingOrder ?? 0));
}

function signerEmails(document: ModusignDocument): string[] {
  return signers(document)
    .filter((participant) => participant.signingMethod?.type === "EMAIL" && participant.signingMethod.value)
    .map((participant) => (participant.signingMethod?.value ?? "").trim().toLowerCase());
}

/** 모두싸인 문서 하나의 서명 진행 요약. 역할은 서명 순서 기준(4명이 아니면 마지막을 강사로). */
export function summarizeSigning(document: ModusignDocument): SigningSummary {
  const list = signers(document);
  const signedIds = new Set((document.signings ?? []).map((signing) => signing.participantId));
  const roleOf = (index: number) =>
    list.length === ROLE_BY_ORDER.length ? ROLE_BY_ORDER[index] : index === list.length - 1 ? "강사" : `서명자 ${index + 1}`;
  const steps = list.map((participant, index) => ({ role: roleOf(index), signed: signedIds.has(participant.id) }));

  const status = document.status;
  const phase: SigningPhase =
    status === "COMPLETED" ? "completed" : status === "ABORTED" ? "aborted" : status === "ON_GOING" ? "signing" : "preparing";

  let currentRole: string | undefined;
  if (phase === "signing") {
    const currentIndex = list.findIndex((participant) => participant.signingOrder === document.currentSigningOrder);
    const fallbackIndex = steps.findIndex((step) => !step.signed);
    const index = currentIndex >= 0 ? currentIndex : fallbackIndex;
    if (index >= 0) currentRole = steps[index].role;
  }
  return { phase, steps, currentRole, updatedAt: document.updatedAt };
}

/** 화면용 한 줄: "OM·부서장 서명됨 → 데이원 서명 대기" / "서명 완료" 등. */
export function describeSigning(summary: SigningSummary): string {
  switch (summary.phase) {
    case "completed":
      return "서명 완료";
    case "aborted":
      return "서명 취소·거절됨";
    case "preparing":
      return "모두싸인 발송 준비 중";
    case "ambiguous":
      return "모두싸인 문서 확인 필요";
    case "signing": {
      const signedRoles = summary.steps.filter((step) => step.signed).map((step) => step.role);
      const waiting = `${summary.currentRole ?? "다음 서명자"} 서명 대기`;
      return signedRoles.length > 0 ? `${signedRoles.join("·")} 서명됨 → ${waiting}` : waiting;
    }
  }
}

export interface SigningMatchInput {
  /** 결과 키(호출자가 정함 — 보통 정규화 코스ID × 정규화 강사명). */
  key: string;
  record: InstructorContractRecord;
}

function createdTime(document: ModusignDocument): number | null {
  const time = Date.parse(document.createdAt ?? "");
  return Number.isNaN(time) ? null : time;
}

/** 이 계약 행이 가리킬 수 있는 문서들(신원 + 기간). 코스명 좁히기 전. */
function identityCandidates(record: InstructorContractRecord, documents: ModusignDocument[]): ModusignDocument[] {
  const email = (record.email ?? "").trim().toLowerCase();
  const name = normalizeInstructorName(record.instructorName);
  const requestedAt = parseSheetTimestamp(record.requestedAt);
  return documents.filter((document) => {
    const identityMatch = email ? signerEmails(document).includes(email) : Boolean(name) && compact(document.title).includes(compact(name));
    if (!identityMatch) return false;
    const created = createdTime(document);
    if (requestedAt === null || created === null) return true;
    return created >= requestedAt - WINDOW_BEFORE_MS && created <= requestedAt + WINDOW_AFTER_MS;
  });
}

/** 제목에 코스명이 들어간 후보만 남긴다. 하나도 없으면(제목 표기가 다르면) 원래 후보를 그대로 쓴다. */
function narrowByCourseName(record: InstructorContractRecord, candidates: ModusignDocument[]): ModusignDocument[] {
  const courseName = compact(record.courseName ?? "");
  if (!courseName || candidates.length <= 1) return candidates;
  const narrowed = candidates.filter((document) => compact(document.title).includes(courseName));
  return narrowed.length > 0 ? narrowed : candidates;
}

/** 한 계약 행에 문서가 여럿이면(취소 후 재발송 등) 취소되지 않은 것 중 가장 최근 것을 고른다. */
function pickLatest(candidates: ModusignDocument[]): ModusignDocument {
  const live = candidates.filter((document) => document.status !== "ABORTED");
  const pool = live.length > 0 ? live : candidates;
  return [...pool].sort((a, b) => (createdTime(b) ?? 0) - (createdTime(a) ?? 0))[0];
}

/**
 * 계약 행마다 모두싸인 문서를 찾아 서명 요약을 돌려준다. 못 찾은 행은 결과에 없다.
 * 같은 강사의 다른 계약 행과 (코스명으로 좁힌 뒤에도) 후보 문서가 겹치면 ambiguous.
 */
export function matchSigningDocuments(inputs: SigningMatchInput[], documents: ModusignDocument[]): Map<string, SigningSummary> {
  const candidatesByKey = new Map<string, ModusignDocument[]>();
  for (const { key, record } of inputs) {
    const candidates = narrowByCourseName(record, identityCandidates(record, documents));
    if (candidates.length > 0) candidatesByKey.set(key, candidates);
  }

  // 문서 → 그 문서를 후보로 가진 계약 행 키들. 2개 이상이면 그 문서는 어느 행 것인지 가를 수 없다.
  const claimants = new Map<string, Set<string>>();
  for (const [key, candidates] of candidatesByKey) {
    for (const document of candidates) {
      const set = claimants.get(document.id) ?? new Set<string>();
      set.add(key);
      claimants.set(document.id, set);
    }
  }

  const results = new Map<string, SigningSummary>();
  for (const [key, candidates] of candidatesByKey) {
    const own = candidates.filter((document) => (claimants.get(document.id)?.size ?? 0) === 1);
    if (own.length > 0) {
      results.set(key, summarizeSigning(pickLatest(own)));
    } else {
      results.set(key, { phase: "ambiguous", steps: [] });
    }
  }
  return results;
}
