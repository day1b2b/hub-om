import { listTeamUsers } from "../teamUsers/teamUserRepository";
import type { OmAvailabilityRoster } from "./omAvailabilityTypes";

const PART_KEYS = ["1파트", "2파트", "3파트"] as const;

// 멤버 관리(TeamUser.team)는 "AX 1파트" 식으로 저장되고, OM 요청(request.team)은 "1파트/3파트"로 저장된다.
// 두 표기가 공유하는 "N파트" 부분만 뽑아 매칭 키로 쓴다.
function extractPartKey(value: string | null | undefined): string | null {
  if (!value) return null;
  return PART_KEYS.find((key) => value.includes(key)) ?? null;
}

export async function getOmAvailabilityRoster(): Promise<OmAvailabilityRoster> {
  const users = await listTeamUsers();

  return users.reduce<OmAvailabilityRoster>((roster, user) => {
    if (user.role !== "om") return roster;
    const partKey = extractPartKey(user.team);
    if (!partKey) return roster;

    roster[partKey] = [...(roster[partKey] ?? []), user.name];
    return roster;
  }, {});
}

export async function getOmNamesForPart(part: string): Promise<string[]> {
  const partKey = extractPartKey(part);
  if (!partKey) return [];

  const roster = await getOmAvailabilityRoster();
  return roster[partKey] ?? [];
}
