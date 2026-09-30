import type { MemberRole as PrismaMemberRole, SourceTeam as PrismaSourceTeam } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER } from "./defaultTeamMemberRoster";
import type { ResourceOwnerRoster, TeamMemberRepository, TeamMemberRole, TeamMemberRoleRoster } from "./teamMemberRepository";
import type { SourceTeam } from "./operationTypes";

const SOURCE_TEAM_LABEL: Record<PrismaSourceTeam, SourceTeam> = {
  TEAM_1: "1팀",
  TEAM_2: "2팀",
  UNKNOWN: "미분류"
};

const TEAM_MEMBER_ROLE_LABEL: Record<PrismaMemberRole, TeamMemberRole> = {
  LD: "ld",
  OM: "om"
};

export class PrismaTeamMemberRepository implements TeamMemberRepository {
  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    const prisma = getPrismaClient();
    const members = await prisma.member.findMany({
      where: {
        isActive: true,
        role: null
      },
      orderBy: [{ sourceTeam: "asc" }, { displayOrder: "asc" }, { name: "asc" }]
    });

    if (members.length === 0) {
      return DEFAULT_RESOURCE_OWNER_ROSTER;
    }

    return members.reduce<ResourceOwnerRoster>((roster, member) => {
      if (!member.sourceTeam) return roster;

      const sourceTeam = SOURCE_TEAM_LABEL[member.sourceTeam];
      roster[sourceTeam] = [...(roster[sourceTeam] ?? []), member.name];
      return roster;
    }, {});
  }

  async listRoleRosters(): Promise<TeamMemberRoleRoster> {
    const prisma = getPrismaClient();
    const users = await prisma.teamUser.findMany({
      where: { role: { not: null } },
      orderBy: [{ role: "asc" }, { team: "asc" }, { name: "asc" }]
    });

    if (users.length === 0) {
      return DEFAULT_TEAM_MEMBER_ROLE_ROSTER;
    }

    const roster = users.reduce<TeamMemberRoleRoster>(
      (roster, user) => {
        if (!user.role) return roster;

        const role = TEAM_MEMBER_ROLE_LABEL[user.role];
        const sourceTeam = toSourceTeam(user.team);

        roster[role][sourceTeam] = [...(roster[role][sourceTeam] ?? []), user.name];
        return roster;
      },
      { ld: {}, om: {} }
    );

    return hasRosterMembers(roster.om) ? roster : { ...roster, om: DEFAULT_TEAM_MEMBER_ROLE_ROSTER.om };
  }
}

function toSourceTeam(team: string | null): SourceTeam {
  return team === "1팀" || team === "2팀" ? team : "미분류";
}

function hasRosterMembers(roster: ResourceOwnerRoster) {
  return Object.values(roster).some((owners) => (owners ?? []).length > 0);
}
