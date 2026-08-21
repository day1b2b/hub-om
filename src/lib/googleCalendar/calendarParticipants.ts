// 운영 1건에서 "어느 파트 캘린더에 넣을지"와 "누구를 초대할지"를 뽑는다.
// 운영 레코드에 파트 필드가 없으므로 담당 OM의 소속 파트(TeamUser.team)로 역산한다.

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
 */
export async function resolveCalendarTargets(operation: OperationSession): Promise<CalendarTargets> {
  const users = await listTeamUsers();

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
  const partKey =
    ownerNames.map((name) => extractPartKey(findTeamUser(users, name)?.team)).find(Boolean) ?? null;

  return { partKey, attendeeEmails, unresolvedNames };
}
