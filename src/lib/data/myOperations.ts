import type { OmRequest } from "./omRequest/omRequestTypes";
import type { OperationSession } from "./operationTypes";
import { splitPersonNames } from "./personNames";
import { listTeamUsers } from "./teamUsers/teamUserRepository";

// 이름 표기 흔들림(괄호/대괄호 주석, 공백, 대소문자)을 흡수해 비교용으로 정규화한다.
// teamScope.ts의 normalizePersonName과 같은 규칙을 사용한다.
export function normalizePersonName(value: string) {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// 로그인 이메일을 명단(team-users.json)의 OM 이름으로 매핑한다.
// 명단에 없으면 null을 돌려주고, 화면에서 "명단에 없음" 상태로 처리한다.
export function resolveOmNameByEmail(email: null | string | undefined): null | string {
  if (!email) return null;

  const target = email.trim().toLowerCase();
  if (!target) return null;

  const match = listTeamUsers().find((user) => user.email.trim().toLowerCase() === target);
  return match?.name ?? null;
}

// om 필드에 해당 OM 이름이 담당자로 포함된 운영만 남긴다.
export function filterOperationsByOm(operations: OperationSession[], omName: string): OperationSession[] {
  const target = normalizePersonName(omName);
  if (!target) return [];

  return operations.filter((operation) =>
    splitPersonNames(operation.om, "").some((owner) => normalizePersonName(owner) === target)
  );
}

// 나에게 배정된 OM 운영 요청만 남긴다. assignedOm은 자유 입력 이름이므로 정규화해 비교한다.
export function filterOmRequestsByAssignee(requests: OmRequest[], omName: string): OmRequest[] {
  const target = normalizePersonName(omName);
  if (!target) return [];

  return requests.filter((request) => !!request.assignedOm && normalizePersonName(request.assignedOm) === target);
}
