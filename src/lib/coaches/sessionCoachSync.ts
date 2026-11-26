// 운영현황 회차의 "실습코치"(coachText 이름들) ↔ 그 회차의 투입(CoachEngagement) 동기화 결정 로직(순수, I/O 없음).
// - 코치 투입·평가의 정본은 운영현황 실습코치(OM이 확정한 값)다. OM이 실습코치 칸을 저장하면 그 이름을
//   코치위키 명부(정규화 이름→coachId)로 풀어, 이 회차의 MANUAL 투입을 만들거나 정리한다.
// - 데이터 손실 0 원칙: 같은 코치의 회차 내 SHEET 투입이 있으면 "전환(SHEET→MANUAL)"하고(삭제 아님 →
//   그 투입에 달린 평가 보존), 취소됐던 MANUAL이 명단에 다시 들면 "재활성"한다. 삭제는 하지 않는다.
// - 취소는 보수적으로만: coachText가 완전히 풀렸을 때(이름이 있고 전부 명부에서 찾힌 경우)에만, 그 명단에서
//   "명백히 빠진" 활성 MANUAL을 취소한다. 빈 칸이나 못 푼 이름이 있으면(= 명단엔 있는데 해석만 실패)
//   취소하지 않는다. 이미 취소된 건 다시 취소하지 않는다.
// - 코치위키에서 못 찾은 이름은 투입을 만들지 않는다(화면이 이미 "명단과 다름" 경고를 함).
import { normalizeCoachName } from "./accessToken";

const CANCELLED = "CANCELLED";

/** coachText에서 코치 이름들을 뽑는다. 콤마·슬래시·가운뎃점 구분, 괄호 주석("(외부인력)" 등)·공백 제거. */
export function parseSessionCoachNames(coachText: string | null | undefined): string[] {
  return String(coachText ?? "")
    .split(/[,/·]/)
    .map((raw) => raw.replace(/\([^)]*\)/g, "").trim())
    .filter(Boolean);
}

export interface ExistingSessionEngagement {
  /** CoachEngagement.id */
  id: string;
  coachId: string;
  source: "SHEET" | "MANUAL";
  /** CoachEngagementStatus. "CANCELLED"면 취소된 상태로 본다. */
  status: string;
}

export interface SessionCoachSyncPlan {
  /** 이 회차에 MANUAL 투입을 새로 만들 coachId들(기존 투입이 아예 없는 명단 코치). */
  createCoachIds: string[];
  /** 명단 코치의 기존 활성 SHEET 투입 → MANUAL로 전환할 engagementId(삭제 아님, 평가 보존). */
  convertEngagementIds: string[];
  /** 명단에 다시 든 코치의 취소된 MANUAL 투입 → 재활성할 engagementId(삭제·재생성 아님, 평가 보존). */
  reactivateEngagementIds: string[];
  /** 명단에서 명백히 빠진 활성 MANUAL 투입 → 취소할 engagementId(완전 해석된 회차에서만). */
  cancelEngagementIds: string[];
  /** 명단에 있으나 코치위키에서 못 찾은 이름(투입 안 만듦, 경고 참고용). */
  unmatchedNames: string[];
}

/**
 * 회차 실습코치(coachText) ↔ 그 회차에 연결된 투입(existing)으로 동기화 계획을 만든다.
 * existing은 "이 회차(operationSessionId=이 회차)에 연결된 CoachEngagement"만 넘긴다.
 * nameToCoachId는 코치위키 명부의 정규화 이름 → coachId 맵이다.
 * 우선순위: 활성 MANUAL 있으면 그대로 / 취소된 MANUAL 있으면 재활성 / 활성 SHEET 있으면 전환 / 없으면 생성.
 */
export function planSessionCoachSync(
  coachText: string | null | undefined,
  existing: ReadonlyArray<ExistingSessionEngagement>,
  nameToCoachId: ReadonlyMap<string, string>
): SessionCoachSyncPlan {
  const names = parseSessionCoachNames(coachText);
  const wantedCoachIds = new Set<string>();
  const unmatchedNames: string[] = [];
  const seenUnmatched = new Set<string>();
  for (const name of names) {
    const coachId = nameToCoachId.get(normalizeCoachName(name));
    if (coachId) {
      wantedCoachIds.add(coachId);
    } else if (!seenUnmatched.has(name)) {
      seenUnmatched.add(name);
      unmatchedNames.push(name);
    }
  }

  // 취소는 "명단이 완전히 해석된" 회차에서만 한다: 이름이 하나라도 있고(빈 칸 아님), 전부 명부에서 찾힌 경우.
  // 그래야 '명단엔 있는데 해석만 실패한' 코치의 투입을 잘못 취소하지 않는다.
  const fullyResolved = names.length > 0 && unmatchedNames.length === 0;
  return { ...planEngagementSet(wantedCoachIds, existing, fullyResolved), unmatchedNames };
}

/**
 * 운영현황 입력이 코치를 '위키에서 ID로 직접 선택'했을 때의 계획(②/S1).
 * 이름 해석 단계가 없고 선택 집합이 곧 정본이므로 unmatched가 없고, 취소를 허용한다:
 * 선택에서 빠진 활성 MANUAL은 취소해 '그 회차의 활성 코치 = 선택한 집합'으로 정확히 맞춘다.
 * coachText 백필과 같은 writer로 반영되며 sourceEngagementId 키가 같아 멱등 수렴한다.
 */
export function planSessionCoachesByIds(
  wantedCoachIds: ReadonlyArray<string>,
  existing: ReadonlyArray<ExistingSessionEngagement>
): Omit<SessionCoachSyncPlan, "unmatchedNames"> {
  return planEngagementSet(new Set(wantedCoachIds), existing, true);
}

/**
 * 계획 코어: 원하는 coachId 집합 ↔ 그 회차의 기존 투입으로 생성/전환/재활성/취소를 가른다.
 * 우선순위: 활성 MANUAL 있으면 그대로 / 취소된 MANUAL 있으면 재활성 / 활성 SHEET 있으면 전환 / 없으면 생성.
 * allowCancel=false면 취소를 내지 않는다(coachText 경로에서 명단을 완전히 해석 못 했을 때의 보호).
 * 이미 취소된 MANUAL은 다시 취소하지 않는다(활성 MANUAL만 취소 후보).
 */
function planEngagementSet(
  wantedCoachIds: ReadonlySet<string>,
  existing: ReadonlyArray<ExistingSessionEngagement>,
  allowCancel: boolean
): Omit<SessionCoachSyncPlan, "unmatchedNames"> {
  const activeManualByCoach = new Map<string, string>(); // coachId → 활성 MANUAL engagementId
  const cancelledManualByCoach = new Map<string, string>(); // coachId → 취소된 MANUAL engagementId(첫 건)
  const activeSheetByCoach = new Map<string, string[]>(); // coachId → 활성 SHEET engagementId[]
  for (const engagement of existing) {
    const cancelled = engagement.status === CANCELLED;
    if (engagement.source === "MANUAL") {
      if (cancelled) {
        if (!cancelledManualByCoach.has(engagement.coachId)) cancelledManualByCoach.set(engagement.coachId, engagement.id);
      } else {
        activeManualByCoach.set(engagement.coachId, engagement.id);
      }
    } else if (!cancelled) {
      activeSheetByCoach.set(engagement.coachId, [...(activeSheetByCoach.get(engagement.coachId) ?? []), engagement.id]);
    }
  }

  const createCoachIds: string[] = [];
  const convertEngagementIds: string[] = [];
  const reactivateEngagementIds: string[] = [];
  for (const coachId of wantedCoachIds) {
    if (activeManualByCoach.has(coachId)) continue; // 이미 활성 MANUAL — 그대로 둠
    const cancelledManualId = cancelledManualByCoach.get(coachId);
    if (cancelledManualId) {
      reactivateEngagementIds.push(cancelledManualId); // 취소됐던 MANUAL을 되살림(재생성·중복 방지)
      continue;
    }
    const sheetIds = activeSheetByCoach.get(coachId);
    if (sheetIds && sheetIds.length > 0) {
      for (const id of sheetIds) convertEngagementIds.push(id); // 활성 SHEET → MANUAL 전환(평가 보존)
    } else {
      createCoachIds.push(coachId); // 기존 투입 없음 — 신규 생성
    }
  }

  const cancelEngagementIds: string[] = [];
  if (allowCancel) {
    for (const [coachId, engagementId] of activeManualByCoach) {
      if (!wantedCoachIds.has(coachId)) cancelEngagementIds.push(engagementId); // 명단에서 명백히 빠진 활성 MANUAL
    }
  }

  return { createCoachIds, convertEngagementIds, reactivateEngagementIds, cancelEngagementIds };
}
