// 운영현황 회차의 "실습코치"(coachText 이름들) ↔ 그 회차의 MANUAL 투입(CoachEngagement) 동기화 결정 로직(순수, I/O 없음).
// - 코치 투입·평가의 정본은 운영현황 실습코치(OM이 확정한 값)다. OM이 실습코치 칸을 저장하면 그 이름을
//   코치위키 명부(정규화 이름→coachId)로 풀어, 이 회차의 MANUAL 투입을 만들거나 지운다.
// - 같은 코치가 이 회차에 이미 SHEET(계약시트발) 투입으로 붙어 있으면, MANUAL이 대체한다(중복 방지).
// - 코치위키에서 못 찾은 이름은 투입을 만들지 않는다(화면이 이미 "명단과 다름" 경고를 함).
import { normalizeCoachName } from "./accessToken";

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
}

export interface SessionCoachSyncPlan {
  /** 이 회차에 MANUAL 투입을 새로 만들 coachId들. */
  createCoachIds: string[];
  /** 실습코치 명단에서 빠진, 기존 MANUAL 투입의 engagementId(제거). */
  removeEngagementIds: string[];
  /** 명단 코치가 이 회차에 이미 가진 SHEET 투입의 engagementId(MANUAL이 대체 → 제거). */
  supersedeEngagementIds: string[];
  /** 명단에 있으나 코치위키에서 못 찾은 이름(투입 안 만듦, 경고 참고용). */
  unmatchedNames: string[];
}

/**
 * 회차 실습코치(coachText) ↔ 그 회차에 이미 연결된 투입(existing)으로 동기화 계획을 만든다.
 * existing은 "이 회차(operationSessionId=이 회차)에 연결된 CoachEngagement"만 넘긴다.
 * nameToCoachId는 코치위키 명부의 정규화 이름 → coachId 맵이다.
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

  const manualByCoach = new Map<string, string>(); // coachId → MANUAL engagementId
  const sheetByCoach = new Map<string, string[]>(); // coachId → SHEET engagementId[]
  for (const engagement of existing) {
    if (engagement.source === "MANUAL") {
      manualByCoach.set(engagement.coachId, engagement.id);
    } else {
      sheetByCoach.set(engagement.coachId, [...(sheetByCoach.get(engagement.coachId) ?? []), engagement.id]);
    }
  }

  const createCoachIds: string[] = [];
  const supersedeEngagementIds: string[] = [];
  for (const coachId of wantedCoachIds) {
    if (!manualByCoach.has(coachId)) createCoachIds.push(coachId);
    for (const sheetId of sheetByCoach.get(coachId) ?? []) supersedeEngagementIds.push(sheetId);
  }

  const removeEngagementIds: string[] = [];
  for (const [coachId, engagementId] of manualByCoach) {
    if (!wantedCoachIds.has(coachId)) removeEngagementIds.push(engagementId);
  }

  return { createCoachIds, removeEngagementIds, supersedeEngagementIds, unmatchedNames };
}
