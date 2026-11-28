// 운영현황 회차의 "강사"(instructorsText 이름들) ↔ 그 회차의 투입(InstructorEngagement) 동기화 결정 로직(순수, I/O 없음).
// 코치 sessionCoachSync를 미러한다(코치 SHEET ↔ 강사 CONTRACT, coachId ↔ instructorNoteId).
// - 강사 투입의 정본은 운영현황 강사(OM이 확정한 값)다. OM이 강사 칸을 저장하면 그 이름을
//   강사위키 명부(정규화 이름→instructorNoteId, 노션 강사 NO에 1:1로 묶임)로 풀어, 이 회차의 MANUAL 투입을 만들거나 정리한다.
// - 데이터 손실 0 원칙: 같은 강사의 회차 내 CONTRACT 투입이 있으면 "전환(CONTRACT→MANUAL)"하고(삭제 아님),
//   취소됐던 MANUAL이 명단에 다시 들면 "재활성"한다. 삭제는 하지 않는다.
// - 취소는 보수적으로만: instructorsText가 완전히 풀렸을 때(이름이 있고 전부 명부에서 찾힌 경우)에만, 그 명단에서
//   "명백히 빠진" 활성 MANUAL을 취소한다. 빈 칸이나 못 푼 이름이 있으면(= 명단엔 있는데 해석만 실패) 취소하지 않는다.
// - 강사위키에서 못 찾은 이름은 투입을 만들지 않는다(화면이 "명단과 다름" 경고를 함).
import { normalizeInstructorName } from "./instructorContractMatch";

const CANCELLED = "CANCELLED";

/** instructorsText에서 강사 이름들을 뽑는다. 콤마·슬래시·가운뎃점 구분, 괄호 소속주석("(존코바)" 등)·공백 제거. */
export function parseSessionInstructorNames(instructorsText: string | null | undefined): string[] {
  return String(instructorsText ?? "")
    .split(/[,/·]/)
    .map((raw) => raw.replace(/\([^)]*\)/g, "").trim())
    .filter(Boolean);
}

export interface ExistingSessionInstructorEngagement {
  /** InstructorEngagement.id */
  id: string;
  instructorNoteId: string;
  source: "CONTRACT" | "MANUAL";
  /** InstructorEngagementStatus. "CANCELLED"면 취소된 상태로 본다. */
  status: string;
}

export interface SessionInstructorSyncPlan {
  /** 이 회차에 MANUAL 투입을 새로 만들 instructorNoteId들(기존 투입이 아예 없는 명단 강사). */
  createInstructorNoteIds: string[];
  /** 명단 강사의 기존 활성 CONTRACT 투입 → MANUAL로 전환할 engagementId(삭제 아님). */
  convertEngagementIds: string[];
  /** 명단에 다시 든 강사의 취소된 MANUAL 투입 → 재활성할 engagementId(삭제·재생성 아님). */
  reactivateEngagementIds: string[];
  /** 명단에서 명백히 빠진 활성 MANUAL 투입 → 취소할 engagementId(완전 해석된 회차에서만). */
  cancelEngagementIds: string[];
  /** 명단에 있으나 강사위키에서 못 찾은 이름(투입 안 만듦, 경고 참고용). */
  unmatchedNames: string[];
}

/**
 * 회차 강사(instructorsText) ↔ 그 회차에 연결된 투입(existing)으로 동기화 계획을 만든다.
 * existing은 "이 회차(operationSessionId=이 회차)에 연결된 InstructorEngagement"만 넘긴다.
 * nameToInstructorNoteId는 강사위키 명부의 정규화 이름 → instructorNoteId 맵이다.
 * 우선순위: 활성 MANUAL 있으면 그대로 / 취소된 MANUAL 있으면 재활성 / 활성 CONTRACT 있으면 전환 / 없으면 생성.
 */
export function planSessionInstructorSync(
  instructorsText: string | null | undefined,
  existing: ReadonlyArray<ExistingSessionInstructorEngagement>,
  nameToInstructorNoteId: ReadonlyMap<string, string>
): SessionInstructorSyncPlan {
  const names = parseSessionInstructorNames(instructorsText);
  const wantedInstructorNoteIds = new Set<string>();
  const unmatchedNames: string[] = [];
  const seenUnmatched = new Set<string>();
  for (const name of names) {
    const instructorNoteId = nameToInstructorNoteId.get(normalizeInstructorName(name));
    if (instructorNoteId) {
      wantedInstructorNoteIds.add(instructorNoteId);
    } else if (!seenUnmatched.has(name)) {
      seenUnmatched.add(name);
      unmatchedNames.push(name);
    }
  }

  // 취소는 "명단이 완전히 해석된" 회차에서만 한다: 이름이 하나라도 있고(빈 칸 아님), 전부 명부에서 찾힌 경우.
  // 그래야 '명단엔 있는데 해석만 실패한' 강사의 투입을 잘못 취소하지 않는다.
  const fullyResolved = names.length > 0 && unmatchedNames.length === 0;
  return { ...planEngagementSet(wantedInstructorNoteIds, existing, fullyResolved), unmatchedNames };
}

/**
 * 운영현황 입력이 강사를 '위키에서 ID로 직접 선택'했을 때의 계획.
 * 이름 해석 단계가 없고 선택 집합이 곧 정본이라 unmatched가 없다.
 * allowCancel은 호출자가 '선택이 그 회차의 완전한 활성 강사 집합'임을 보장할 때만 true로 준다
 * (프론트가 동명이인 미해결을 막고, 빈 선택은 취소하지 않는다 — instructorsText 경로의 보수적 취소와 대칭).
 * instructorsText 백필과 같은 writer로 반영되며 sourceEngagementId 키가 같아 멱등 수렴한다.
 */
export function planSessionInstructorsByIds(
  wantedInstructorNoteIds: ReadonlyArray<string>,
  existing: ReadonlyArray<ExistingSessionInstructorEngagement>,
  allowCancel: boolean
): Omit<SessionInstructorSyncPlan, "unmatchedNames"> {
  return planEngagementSet(new Set(wantedInstructorNoteIds), existing, allowCancel);
}

/**
 * 계획 코어: 원하는 instructorNoteId 집합 ↔ 그 회차의 기존 투입으로 생성/전환/재활성/취소를 가른다.
 * 우선순위: 활성 MANUAL 있으면 그대로 / 취소된 MANUAL 있으면 재활성 / 활성 CONTRACT 있으면 전환 / 없으면 생성.
 * allowCancel=false면 취소를 내지 않는다(instructorsText 경로에서 명단을 완전히 해석 못 했을 때의 보호).
 * 이미 취소된 MANUAL은 다시 취소하지 않는다(활성 MANUAL만 취소 후보).
 */
function planEngagementSet(
  wantedInstructorNoteIds: ReadonlySet<string>,
  existing: ReadonlyArray<ExistingSessionInstructorEngagement>,
  allowCancel: boolean
): Omit<SessionInstructorSyncPlan, "unmatchedNames"> {
  const activeManualByInstructor = new Map<string, string>(); // instructorNoteId → 활성 MANUAL engagementId
  const cancelledManualByInstructor = new Map<string, string>(); // instructorNoteId → 취소된 MANUAL engagementId(첫 건)
  const activeContractByInstructor = new Map<string, string[]>(); // instructorNoteId → 활성 CONTRACT engagementId[]
  for (const engagement of existing) {
    const cancelled = engagement.status === CANCELLED;
    if (engagement.source === "MANUAL") {
      if (cancelled) {
        if (!cancelledManualByInstructor.has(engagement.instructorNoteId)) cancelledManualByInstructor.set(engagement.instructorNoteId, engagement.id);
      } else {
        activeManualByInstructor.set(engagement.instructorNoteId, engagement.id);
      }
    } else if (!cancelled) {
      activeContractByInstructor.set(engagement.instructorNoteId, [...(activeContractByInstructor.get(engagement.instructorNoteId) ?? []), engagement.id]);
    }
  }

  const createInstructorNoteIds: string[] = [];
  const convertEngagementIds: string[] = [];
  const reactivateEngagementIds: string[] = [];
  for (const instructorNoteId of wantedInstructorNoteIds) {
    if (activeManualByInstructor.has(instructorNoteId)) continue; // 이미 활성 MANUAL — 그대로 둠
    const cancelledManualId = cancelledManualByInstructor.get(instructorNoteId);
    if (cancelledManualId) {
      reactivateEngagementIds.push(cancelledManualId); // 취소됐던 MANUAL을 되살림(재생성·중복 방지)
      continue;
    }
    const contractIds = activeContractByInstructor.get(instructorNoteId);
    if (contractIds && contractIds.length > 0) {
      for (const id of contractIds) convertEngagementIds.push(id); // 활성 CONTRACT → MANUAL 전환
    } else {
      createInstructorNoteIds.push(instructorNoteId); // 기존 투입 없음 — 신규 생성
    }
  }

  const cancelEngagementIds: string[] = [];
  if (allowCancel) {
    for (const [instructorNoteId, engagementId] of activeManualByInstructor) {
      if (!wantedInstructorNoteIds.has(instructorNoteId)) cancelEngagementIds.push(engagementId); // 명단에서 명백히 빠진 활성 MANUAL
    }
  }

  return { createInstructorNoteIds, convertEngagementIds, reactivateEngagementIds, cancelEngagementIds };
}
