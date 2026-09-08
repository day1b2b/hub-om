// 운영 1건에서 "어느 파트 캘린더에 넣을지"와 "누구를 초대할지"를 뽑는다.
// 운영 레코드에 파트 필드가 없으므로 담당 OM의 소속 파트(TeamUser.team)로 역산하고,
// 담당 OM이 아직 없으면(접수 직후) 요청 LD의 소속 파트로 정한다(아래 partKey 산출 참고).

import { splitPersonNames } from "@/lib/data/personNames";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes";
import type { OperationSession } from "@/lib/data/operationTypes";
import { extractPartKey } from "./calendarWriteConfig";

// 운영현황에 배정 전 자리표시자로 들어가는 값. 사람 이름이 아니므로 초대 대상에서 뺀다.
const PLACEHOLDER_NAMES = new Set(["배정필요", "미정", "-"]);

function assigneeNames(value: string | null | undefined): string[] {
  return splitPersonNames(value, "").filter((name) => name && !PLACEHOLDER_NAMES.has(name));
}

function findTeamUser(users: TeamUser[], name: string): TeamUser | undefined {
  return users.find((user) => user.name === name);
}

export interface CalendarTargets {
  /** 이벤트를 만들 파트 캘린더. 못 정하면 빈 문자열. */
  partKey: string | null;
  /** 담당 OM + 현장운영 OM 이메일. 중복 제거됨. */
  attendeeEmails: string[];
  /** 이름은 있는데 이메일을 못 찾은 사람. 호출부에서 로그로 남긴다. */
  unresolvedNames: string[];
}

/**
 * 담당 OM과 현장운영 OM을 초대 대상으로 모은다(스펙 D3).
 * 이메일이 없는 사람은 조용히 빼고 unresolvedNames로 돌려준다 — 한 명 때문에
 * 일정 자체가 안 만들어지면 더 나쁘기 때문이다(스펙 §6).
 *
 * 명단(TeamUser)을 미리 읽어 넘길 수 있게 순수 함수로 뽑았다. 일괄 소급 반영은
 * 회차 수백 건을 한 번에 돌아서, 회차마다 listTeamUsers()를 다시 부르면 DB를 그만큼
 * 두드린다. 소급 도구는 명단을 한 번만 읽어 이 함수에 넘긴다.
 */
export function resolveCalendarTargetsFromUsers(
  operation: OperationSession,
  users: TeamUser[]
): CalendarTargets {
  const ownerNames = assigneeNames(operation.om);
  const onsiteNames = assigneeNames(operation.onsiteOm);

  const attendeeEmails: string[] = [];
  const unresolvedNames: string[] = [];

  for (const name of [...ownerNames, ...onsiteNames]) {
    const user = findTeamUser(users, name);
    if (user?.email) {
      if (!attendeeEmails.includes(user.email)) attendeeEmails.push(user.email);
      continue;
    }
    if (!unresolvedNames.includes(name)) unresolvedNames.push(name);
  }

  // 파트는 담당 OM 기준이다. 담당 OM이 여럿이면 파트를 찾은 첫 사람을 따른다.
  const ownerPartKey =
    ownerNames.map((name) => extractPartKey(findTeamUser(users, name)?.team)).find(Boolean) ?? null;

  // 담당 OM으로 파트를 못 정하면 요청 LD의 소속 파트로 정한다.
  // om-request로 접수된 과정은 생성 시점에 OM이 비어 있어(나중에 배정) 파트를 못 뽑고,
  // 그러면 생성 반영이 통째로 빠진다. 그 뒤 OM을 지정해도 매핑이 없어 "수정" 반영이 skip돼
  // (reflectOperationToCalendar의 existing.length===0 && trigger==="updated" 가드) 영구 누락된다.
  // 파트별 캘린더인데 파트를 담당자에게만 의존한 게 원인이다. LD(operation.ld)는 접수 시점부터
  // 있으므로, OM 배정 전에도 LD 소속 파트로 캘린더를 정해 생성 시점에 이벤트·매핑을 만든다
  // (그러면 나중 OM 지정 때 매핑이 있어 정상 반영된다). LD 소속이 파트(1/2/3)가 아니면 못 뽑는다.
  // LD는 파트 판정에만 쓰고 초대 대상(attendeeEmails)에는 넣지 않는다 — 초대는 담당·현장 OM만(D3).
  const partKey =
    ownerPartKey ??
    (assigneeNames(operation.ld)
      .map((name) => extractPartKey(findTeamUser(users, name)?.team))
      .find(Boolean) ?? null);

  return { partKey, attendeeEmails, unresolvedNames };
}

export async function resolveCalendarTargets(operation: OperationSession): Promise<CalendarTargets> {
  return resolveCalendarTargetsFromUsers(operation, await listTeamUsers());
}
