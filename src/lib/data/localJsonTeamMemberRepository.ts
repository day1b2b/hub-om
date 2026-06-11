import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER } from "./defaultTeamMemberRoster";
import type { SourceTeam } from "./operationTypes";
import type { ResourceOwnerRoster, TeamMemberRepository, TeamMemberRoleRoster } from "./teamMemberRepository";

interface LocalTeamMember {
  name?: string;
  role?: string;
  sourceTeam?: SourceTeam;
}

interface LocalTeamMemberPayload {
  members?: LocalTeamMember[];
}

export class LocalJsonTeamMemberRepository implements TeamMemberRepository {
  constructor(private readonly fileName = "team-members.json") {}

  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    const members = await this.readMembers();

    if (members === null) {
      return DEFAULT_RESOURCE_OWNER_ROSTER;
    }

    return members.reduce<ResourceOwnerRoster>((roster, member) => {
      if (!member.name || !member.sourceTeam) return roster;

      roster[member.sourceTeam] = [...(roster[member.sourceTeam] ?? []), member.name.trim()];
      return roster;
    }, {});
  }

  async listRoleRosters(): Promise<TeamMemberRoleRoster> {
    const members = await this.readMembers();

    if (members === null) {
      return DEFAULT_TEAM_MEMBER_ROLE_ROSTER;
    }

    const roster = members.reduce<TeamMemberRoleRoster>(
      (roster, member) => {
        const role = normalizeRole(member.role);
        if (!member.name || !member.sourceTeam || !role) return roster;

        roster[role][member.sourceTeam] = [...(roster[role][member.sourceTeam] ?? []), member.name.trim()];
        return roster;
      },
      { ld: {}, om: {} }
    );

    return hasRosterMembers(roster.om) ? roster : { ...roster, om: DEFAULT_TEAM_MEMBER_ROLE_ROSTER.om };
  }

  private async readMembers() {
    try {
      const localDir = path.resolve(process.cwd(), ".local");
      const localFileName = path.normalize(this.fileName.replace(/^\.local[\/\\]/, ""));
      const absolutePath = path.resolve(localDir, localFileName);

      if (!absolutePath.startsWith(`${localDir}${path.sep}`)) {
        return [];
      }

      const raw = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw) as LocalTeamMemberPayload;
      return parsed.members ?? [];
    } catch {
      return null;
    }
  }
}

function hasRosterMembers(roster: ResourceOwnerRoster) {
  return Object.values(roster).some((owners) => (owners ?? []).length > 0);
}

function normalizeRole(value: string | undefined) {
  if (value === "om" || value === "OM") return "om";
  if (value === "ld" || value === "LD") return "ld";

  return null;
}
