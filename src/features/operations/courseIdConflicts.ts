import { normalizeCourseId } from "@/lib/data/operationCalculations";
import type { OperationSession } from "@/lib/data/operationTypes";

/**
 * 한 코스ID가 서로 다른 기업에 걸려 있는 경우를 찾는다.
 *
 * 코스ID는 과정을 가리키는 값이라 한 기업 안에서만 쓰여야 한다. 두 기업에 같은 코스ID가
 * 붙으면 둘 중 하나는 잘못 입력된 것이다. 실데이터에서 8건 나왔고, 그중에는 서로 다른
 * 계약이 섞인 것도 있었다(풍산 + LS전선, HL만도 + 효성ITX).
 *
 * 매출 집계가 코스ID별로 최댓값 하나만 잡기 때문에, 서로 다른 계약이 같은 코스ID를 쓰면
 * 작은 쪽 매출이 총계에서 빠진다. 화면에서 바로 보이게 해 두면 쌓이기 전에 잡는다.
 *
 * 돌려주는 값의 키는 정규화한 코스ID다. 화면에서 조회할 때도 정규화해서 찾아야 한다.
 */
export function findCourseIdConflicts(
  operations: ReadonlyArray<Pick<OperationSession, "companyName" | "courseId">>
): Map<string, string[]> {
  const companiesByCourseId = new Map<string, Set<string>>();

  for (const operation of operations) {
    const key = normalizeCourseId(operation.courseId);
    if (!key) continue; // 코스ID가 없으면 판단할 근거가 없다.

    const company = (operation.companyName ?? "").trim();
    if (!company) continue;

    const companies = companiesByCourseId.get(key);
    if (companies) companies.add(company);
    else companiesByCourseId.set(key, new Set([company]));
  }

  const conflicts = new Map<string, string[]>();
  for (const [key, companies] of companiesByCourseId) {
    if (companies.size > 1) {
      conflicts.set(key, [...companies].sort((a, b) => a.localeCompare(b, "ko")));
    }
  }

  return conflicts;
}
