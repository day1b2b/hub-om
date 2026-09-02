import { normalizePersonName } from "@/lib/data/myOperations";
import { splitPersonNames } from "@/lib/data/personNames";
import type { OperationSession } from "@/lib/data/operationTypes";

export interface OmNameDiagnosis {
  /** 앱이 인식한 내 이름. */
  omName: string;
  /** 운영 현황 전체 건수(내 담당으로 걸러내기 전). */
  totalOperations: number;
  /** 이 이메일로 명단에 등록된 이름들. 둘 이상이면 그게 원인이다. */
  rosterNamesForEmail: string[];
  /** 운영 현황 OM 칸에 실제로 쓰인 이름들(앞 몇 개). 표기를 맞출 때 비교용. */
  omNamesInOperations: string[];
}

/** 운영 현황 OM·현장운영 칸에 쓰인 이름을 중복 없이 모은다. */
export function collectOmNames(operations: ReadonlyArray<OperationSession>): string[] {
  const names = new Set<string>();
  for (const operation of operations) {
    for (const value of [operation.om, operation.onsiteOm]) {
      for (const name of splitPersonNames(value ?? "", "")) {
        const trimmed = name.trim();
        if (trimmed) names.add(trimmed);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

/**
 * "운영 현황에는 과정이 많은데 내 대시보드는 0건"인 상황을 짚어 준다.
 *
 * 내 대시보드는 로그인 이메일 → 명단(team_users)의 이름 → 운영 현황 OM 칸 순으로 이어져 있다.
 * 가운데 이름이 운영 현황 표기와 다르면 366건이 있어도 0건으로 보인다.
 *
 * 실제로 이렇게 났다: 같은 이메일로 명단 행이 두 개 만들어졌고, 명단 조회가
 * createdAt 내림차순이라 나중 행의 이름이 이겼다. 그 이름이 운영 현황 표기와 달라
 * 잘 보이던 대시보드가 통째로 비었다. 그런데 화면 문구는 "배정된 담당 과정이 없습니다"
 * 하나뿐이라, 정말 담당이 없는 것과 구분되지 않았다. 원인을 화면에서 바로 읽게 만든다.
 *
 * 담당이 하나라도 잡히면 진단하지 않는다(정상 동작이므로 알릴 것이 없다).
 */
export function diagnoseOmNameMismatch(input: {
  omName: null | string;
  matchedOperations: number;
  matchedRequests: number;
  operations: ReadonlyArray<OperationSession>;
  rosterNamesForEmail: ReadonlyArray<string>;
  nameSampleSize?: number;
}): OmNameDiagnosis | null {
  const omName = (input.omName ?? "").trim();
  if (!omName) return null; // 명단 미등록은 이미 별도 화면으로 알린다.
  if (input.matchedOperations > 0 || input.matchedRequests > 0) return null;
  if (input.operations.length === 0) return null; // 원천 자체가 비었으면 이름 문제가 아니다.

  const allNames = collectOmNames(input.operations);
  const target = normalizePersonName(omName);
  const rosterNames = [...new Set(input.rosterNamesForEmail.map((name) => name.trim()).filter(Boolean))];

  // 이름이 운영 현황 표기와 맞는데도 0건이면 다른 원인이다. 엉뚱하게 이름을 지목하지 않는다.
  // 단, 이메일 중복은 그 자체로 알려야 한다 — 지금 이긴 이름이 우연히 맞았을 뿐이다.
  const nameMatches = allNames.some((name) => normalizePersonName(name) === target);
  if (nameMatches && rosterNames.length <= 1) return null;

  const size = input.nameSampleSize ?? 12;
  // 내 이름과 겹치는 표기를 먼저 보여 준다. "김정선" ↔ "김정선A" 같은 어긋남을 바로 찾게.
  const related = allNames.filter((name) => name.includes(omName) || omName.includes(name));
  const rest = allNames.filter((name) => !related.includes(name));

  return {
    omName,
    totalOperations: input.operations.length,
    rosterNamesForEmail: rosterNames,
    omNamesInOperations: [...related, ...rest].slice(0, size)
  };
}
