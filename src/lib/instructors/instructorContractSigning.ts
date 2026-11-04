// 모두싸인 문서 → 강사 계약(코스ID × 강사) 매칭과 서명 진행 요약. 순수 함수(I/O 없음).
// 시트 F열 "최종완료"는 발송 처리 완료라 서명 여부를 알 수 없다(2026-11-03 대조). 서명은 모두싸인만 안다.
//
// 매칭 키: 모두싸인 제목 앞 번호는 코스ID가 아니라서, 시트 행(코스ID × 강사)의
//   ① 강사 이메일(Q) = 서명자 중 EMAIL 서명 방식의 값 (없으면 제목에 강사명 포함으로 대신)
//   ② 요청 시각(AE) 하루 전 ~ 90일 뒤에 생성된 문서
//   ③ 후보가 여럿이면 제목이 코스명(K)과 가장 비슷한 것으로 좁힘
//   ④ 그래도 같은 강사의 다른 계약 행과 문서가 겹치면, 문서는 생성 직전에 요청된 행의 것(시간순)
// 으로 찾는다. 시간순으로도 가를 수 없으면 추측하지 않고 "확인 필요"(ambiguousReason에 이유)로 둔다.
// 이메일은 비교에만 쓰고 결과(요약)에는 남기지 않는다.
import type { ModusignDocument, ModusignParticipant } from "@/lib/modusign/modusignClient";
import type { InstructorContractRecord } from "./instructorContractSheet";
import { normalizeInstructorName } from "./instructorContractMatch";

/** 서명 순서(1~4)에 붙는 역할. 회사 계약 양식 순서 = 담당 OM → 부서장 → 데이원컴퍼니 → 강사. */
const ROLE_BY_ORDER = ["OM", "부서장", "데이원", "강사"] as const;

/**
 * 서명 진행을 보여 주는 과정 = 교육 시작일이 이날 이후(2026-11-04 결정). 이전 과정은 시트 단계(요청·발송)만 보인다.
 * 모두싸인은 그보다 한 달 앞(8/1)에 만든 문서부터 읽는다 — 9월 초 시작 과정의 계약서가 8월에 만들어질 수 있다.
 * 기준일이 고정이라 문서가 달마다(~130건) 쌓인다. 읽기 상한(30페이지 = 3,000건)에 가까워지면 두 날짜를 함께 옮긴다.
 */
export const SIGNING_TRACKED_FROM_COURSE_START = "2026-09-01";
export const MODUSIGN_DOCUMENTS_SINCE = "2026-08-01T00:00:00+09:00";

/** 교육 시작일(yyyy-mm-dd)로 이 과정이 서명 진행 표시 대상인지. */
export function isSigningTracked(courseStartDate: string | undefined): boolean {
  return Boolean(courseStartDate) && (courseStartDate as string) >= SIGNING_TRACKED_FROM_COURSE_START;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_BEFORE_MS = DAY_MS;
const WINDOW_AFTER_MS = 90 * DAY_MS;

export type SigningPhase = "signing" | "completed" | "aborted" | "preparing" | "ambiguous";

/**
 * "확인 필요" 이유. no-requested-at = 겹친 행에 요청 시각(AE)이 없음,
 * same-time-requests = 겹친 행들이 하루 안에 연달아 요청돼 순서로 못 가름,
 * uneven-split = 시간순으로 나눴더니 한 행이 문서 여럿·다른 행은 0개(배정이 틀렸을 수 있음).
 */
export type AmbiguousReason = "no-requested-at" | "same-time-requests" | "uneven-split";

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
  /** ambiguous일 때 이유(진단용). */
  ambiguousReason?: AmbiguousReason;
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

// 제목이 코스명과 이만큼 비슷해야 좁히기에 쓴다. 같은 고객사 과정끼리는 "(B2B) 고객사_" 앞부분이 겹쳐 0.5 안팎이 나온다.
const COURSE_NAME_MIN_SCORE = 0.7;
const COURSE_NAME_TIE = 0.05;

/** 코스명이 제목에 얼마나 들어 있는지(0~1). 그대로 들어 있으면 1, 아니면 코스명의 두 글자 묶음이 제목에 있는 비율. */
export function courseNameScore(courseName: string, title: string): number {
  const name = compact(courseName);
  const haystack = compact(title);
  if (!name) return 0;
  if (haystack.includes(name)) return 1;
  const grams = (value: string) => {
    const set = new Set<string>();
    for (let index = 0; index < value.length - 1; index++) set.add(value.slice(index, index + 2));
    return set;
  };
  const nameGrams = grams(name);
  if (nameGrams.size === 0) return 0;
  const titleGrams = grams(haystack);
  let hit = 0;
  for (const gram of nameGrams) if (titleGrams.has(gram)) hit++;
  return hit / nameGrams.size;
}

/** 제목이 코스명과 가장 비슷한 후보만 남긴다. 충분히 비슷한 게 없으면(제목 표기가 다르면) 원래 후보를 그대로 쓴다. */
function narrowByCourseName(record: InstructorContractRecord, candidates: ModusignDocument[]): ModusignDocument[] {
  const courseName = record.courseName ?? "";
  if (!compact(courseName) || candidates.length <= 1) return candidates;
  const scored = candidates.map((document) => ({ document, score: courseNameScore(courseName, document.title) }));
  const top = Math.max(...scored.map((item) => item.score));
  if (top < COURSE_NAME_MIN_SCORE) return candidates;
  return scored.filter((item) => item.score >= top - COURSE_NAME_TIE).map((item) => item.document);
}

/** 한 계약 행에 문서가 여럿이면(취소 후 재발송 등) 취소되지 않은 것 중 가장 최근 것을 고른다. */
function pickLatest(candidates: ModusignDocument[]): ModusignDocument {
  const live = candidates.filter((document) => document.status !== "ABORTED");
  const pool = live.length > 0 ? live : candidates;
  return [...pool].sort((a, b) => (createdTime(b) ?? 0) - (createdTime(a) ?? 0))[0];
}

/**
 * 여러 행이 후보로 가진 문서의 주인 = 문서 생성 직전(하루 여유)에 요청된 행. 계약서는 요청을 받고 만들기 때문이다.
 * 요청 시각이 없는 행이 끼었거나, 바로 앞 요청이 하루 안에 둘 이상이면 가를 수 없다.
 */
function ownerByTime(
  document: ModusignDocument,
  claimants: { key: string; requestedAt: number | null }[]
): { owner: string } | { reason: AmbiguousReason } {
  const created = createdTime(document);
  if (created === null || claimants.some((claimant) => claimant.requestedAt === null)) return { reason: "no-requested-at" };
  const before = claimants
    .filter((claimant) => (claimant.requestedAt as number) - WINDOW_BEFORE_MS <= created)
    .sort((a, b) => (b.requestedAt as number) - (a.requestedAt as number));
  if (before.length === 0) return { reason: "same-time-requests" };
  if (before.length > 1 && (before[0].requestedAt as number) - (before[1].requestedAt as number) < DAY_MS) {
    return { reason: "same-time-requests" };
  }
  return { owner: before[0].key };
}

/**
 * 계약 행마다 모두싸인 문서를 찾아 서명 요약을 돌려준다. 못 찾은 행은 결과에 없다.
 * 문서를 한 행만 후보로 가지면 그 행 것, 여러 행이 겹치면 시간순(ownerByTime)으로 나누고, 그래도 못 가르면 ambiguous.
 */
export function matchSigningDocuments(inputs: SigningMatchInput[], documents: ModusignDocument[]): Map<string, SigningSummary> {
  const candidatesByKey = new Map<string, ModusignDocument[]>();
  const requestedAtByKey = new Map<string, number | null>();
  for (const { key, record } of inputs) {
    const candidates = narrowByCourseName(record, identityCandidates(record, documents));
    if (candidates.length === 0) continue;
    candidatesByKey.set(key, candidates);
    requestedAtByKey.set(key, parseSheetTimestamp(record.requestedAt));
  }

  // 문서 → 그 문서를 후보로 가진 계약 행 키들.
  const claimants = new Map<string, Set<string>>();
  const documentById = new Map<string, ModusignDocument>();
  for (const [key, candidates] of candidatesByKey) {
    for (const document of candidates) {
      documentById.set(document.id, document);
      const set = claimants.get(document.id) ?? new Set<string>();
      set.add(key);
      claimants.set(document.id, set);
    }
  }

  const assigned = new Map<string, ModusignDocument[]>();
  const blocked = new Map<string, AmbiguousReason>();
  for (const [documentId, keys] of claimants) {
    const document = documentById.get(documentId) as ModusignDocument;
    const resolved =
      keys.size === 1
        ? { owner: [...keys][0] }
        : ownerByTime(document, [...keys].map((key) => ({ key, requestedAt: requestedAtByKey.get(key) ?? null })));
    if ("owner" in resolved) {
      assigned.set(resolved.owner, [...(assigned.get(resolved.owner) ?? []), document]);
    } else {
      for (const key of keys) if (!blocked.has(key)) blocked.set(key, resolved.reason);
    }
  }

  // 안전망: 한 행이 살아 있는 문서를 둘 이상 받았는데 그 문서를 다투던 다른 행은 하나도 못 받았으면
  // (요청 두 건 뒤에 계약서 두 장을 연달아 만든 경우 등) 시간순 배정이 틀렸을 수 있다.
  const uneven = new Set<string>();
  for (const [key, owned] of assigned) {
    if (owned.filter((document) => document.status !== "ABORTED").length < 2) continue;
    const rivals = new Set(owned.flatMap((document) => [...(claimants.get(document.id) ?? [])]).filter((other) => other !== key));
    const starved = [...rivals].filter((other) => !assigned.has(other));
    if (starved.length === 0) continue;
    for (const other of [key, ...starved]) uneven.add(other);
  }

  const results = new Map<string, SigningSummary>();
  for (const key of candidatesByKey.keys()) {
    const owned = assigned.get(key) ?? [];
    const reason = uneven.has(key) ? "uneven-split" : owned.length === 0 ? blocked.get(key) : undefined;
    if (reason) {
      results.set(key, { phase: "ambiguous", steps: [], ambiguousReason: reason });
    } else if (owned.length > 0) {
      results.set(key, summarizeSigning(pickLatest(owned)));
    }
    // 후보가 모두 다른 행 몫으로 갔으면 이 행은 문서를 못 찾은 것이다(결과 없음).
  }
  return results;
}
