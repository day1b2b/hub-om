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
export async function resolveOmNameByEmail(email: null | string | undefined): Promise<null | string> {
  if (!email) return null;

  const target = email.trim().toLowerCase();
  if (!target) return null;

  const users = await listTeamUsers();
  const match = users.find((user) => user.email.trim().toLowerCase() === target);
  return match?.name ?? null;
}

// 현장운영 OM 선택 목록을 로그인한 사람의 파트(team-users.json의 team)로 좁힌다.
// 본인 소속 파트를 알 수 없으면(명단에 없거나 파트 미지정) fallbackOptions를 그대로 돌려준다.
export async function resolveOnsiteOmOptionsByEmail(
  email: null | string | undefined,
  fallbackOptions: string[]
): Promise<string[]> {
  if (!email) return fallbackOptions;

  const target = email.trim().toLowerCase();
  if (!target) return fallbackOptions;

  const users = await listTeamUsers();
  const currentUser = users.find((user) => user.email.trim().toLowerCase() === target);

  if (!currentUser?.team) return fallbackOptions;

  const partOmNames = users
    .filter((user) => user.role === "om" && user.team === currentUser.team)
    .map((user) => user.name.trim())
    .filter(Boolean);

  return [...new Set(partOmNames)].sort((a, b) => a.localeCompare(b, "ko-KR"));
}

// om(운영 담당) 또는 onsiteOm(현장운영 OM)에 해당 이름이 포함된 운영을 남긴다.
// 내 대시보드는 내가 운영 담당이거나 현장운영으로 지정된 과정을 모두 보여준다.
export function filterOperationsByOm(operations: OperationSession[], omName: string): OperationSession[] {
  const target = normalizePersonName(omName);
  if (!target) return [];

  const isMine = (value: string) =>
    splitPersonNames(value, "").some((owner) => normalizePersonName(owner) === target);

  return operations.filter((operation) => isMine(operation.om) || isMine(operation.onsiteOm));
}

// 나에게 배정된 OM 운영 요청만 남긴다. assignedOm은 자유 입력 이름이므로 정규화해 비교한다.
export function filterOmRequestsByAssignee(requests: OmRequest[], omName: string): OmRequest[] {
  const target = normalizePersonName(omName);
  if (!target) return [];

  return requests.filter((request) => !!request.assignedOm && normalizePersonName(request.assignedOm) === target);
}
