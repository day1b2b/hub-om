// 이 모듈은 클라이언트 컴포넌트(MyDashboard)에서 import된다. myOperations의
// normalizePersonName은 같은 규칙이지만 그 모듈이 Prisma·pg를 끌고 와서
// 브라우저 번들에 들어가 빌드가 깨진다. 순수 모듈의 같은 함수를 쓴다.
import { splitPersonNames } from "@/lib/data/personNames";
import { normalizePersonKey } from "@/lib/data/roleAssignees";

/**
 * 이 과정에서 내가 "현장운영 지원자"인가.
 *
 * 내 대시보드에 "_현장운영지원"을 붙이는 목적은 남의 과정에 현장 지원만 들어가는 건을
 * 내가 담당한 과정과 구별하는 것이다. 그래서 담당 OM 칸에 내 이름이 있으면 붙이지 않는다 —
 * 그 과정이 현장운영이 필요한 건이고 내가 현장에 가더라도, 나는 지원자가 아니라 담당자다.
 *
 * 전에는 운영의 onsiteRequired만 봤다. 그래서 담당 OM인 과정에도 "_현장운영지원"이 붙어,
 * 내가 담당인 과정과 지원만 들어가는 과정이 화면에서 구별되지 않았다.
 *
 * 양쪽에 다 있으면 담당으로 본다(담당 역할이 더 무겁다).
 */
export function isOnsiteSupportForViewer(
  assignment: { om?: null | string; onsiteOm?: null | string },
  omName: null | string
): boolean {
  const target = normalizePersonKey(omName ?? "");
  if (!target) return false;

  const includesMe = (value: null | string | undefined) =>
    splitPersonNames(value ?? "", "").some((name) => normalizePersonKey(name) === target);

  if (includesMe(assignment.om)) return false; // 담당 OM이면 지원자가 아니다.
  return includesMe(assignment.onsiteOm);
}

/** 캘린더 막대에 쓰는 이름. 현장운영 지원 건만 기업명 뒤에 표시를 붙인다. */
export function calendarLabel(companyName: string, onsiteSupport: boolean): string {
  // 기업명 뒤에 바로 붙여, 막대가 좁아 잘려도 앞부분이 먼저 보이게 한다.
  return onsiteSupport ? `${companyName}_현장운영지원` : companyName;
}
