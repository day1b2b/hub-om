import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodePrivateJson } from "../privacy/crypto";
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
  private readonly fileName: string;

  constructor(fileName = "team-members.json") {
    this.fileName = fileName;
  }

  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    const members = await this.readMembers();

    if (members === null) {
      return DEFAULT_RESOURCE_OWNER_ROSTER;
    }

    return members.reduce<ResourceOwnerRoster>((roster, member) => {
      if (!member.name || !member.sourceTeam || normalizeRole(member.role)) return roster;

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
        throw new Error("Local team-member file must be inside .local.");
      }

      const raw = await readFile(absolutePath, "utf8");
      const parsed = decodePrivateJson(raw.trimEnd(), "local:team-members") as LocalTeamMemberPayload;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed.members !== undefined && !Array.isArray(parsed.members))) {
        throw new Error("Invalid local team-member data.");
      }
      return parsed.members ?? [];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
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
