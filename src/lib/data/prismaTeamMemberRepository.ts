import type { SourceTeam as PrismaSourceTeam, TeamMemberRole as PrismaTeamMemberRole } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER } from "./defaultTeamMemberRoster";
import type { ResourceOwnerRoster, TeamMemberRepository, TeamMemberRole, TeamMemberRoleRoster } from "./teamMemberRepository";
import type { SourceTeam } from "./operationTypes";

const SOURCE_TEAM_LABEL: Record<PrismaSourceTeam, SourceTeam> = {
  TEAM_1: "1팀",
  TEAM_2: "2팀",
  UNKNOWN: "미분류"
};

const TEAM_MEMBER_ROLE_LABEL: Record<PrismaTeamMemberRole, TeamMemberRole> = {
  LD: "ld",
  OM: "om"
};

export class PrismaTeamMemberRepository implements TeamMemberRepository {
  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    const prisma = getPrismaClient();
    const members = await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: [{ sourceTeam: "asc" }, { displayOrder: "asc" }, { name: "asc" }]
    });

    if (members.length === 0) {
      return DEFAULT_RESOURCE_OWNER_ROSTER;
    }

    return members.reduce<ResourceOwnerRoster>((roster, member) => {
      const sourceTeam = SOURCE_TEAM_LABEL[member.sourceTeam];
      roster[sourceTeam] = [...(roster[sourceTeam] ?? []), member.name];
      return roster;
    }, {});
  }

  async listRoleRosters(): Promise<TeamMemberRoleRoster> {
    const prisma = getPrismaClient();
    const members = await prisma.teamMember.findMany({
      where: {
        isActive: true,
        role: { not: null }
      },
      orderBy: [{ role: "asc" }, { sourceTeam: "asc" }, { displayOrder: "asc" }, { name: "asc" }]
    });

    if (members.length === 0) {
      return DEFAULT_TEAM_MEMBER_ROLE_ROSTER;
    }

    const roster = members.reduce<TeamMemberRoleRoster>(
      (roster, member) => {
        if (!member.role) return roster;

        const role = TEAM_MEMBER_ROLE_LABEL[member.role];
        const sourceTeam = SOURCE_TEAM_LABEL[member.sourceTeam];

        roster[role][sourceTeam] = [...(roster[role][sourceTeam] ?? []), member.name];
        return roster;
      },
      { ld: {}, om: {} }
    );

    return hasRosterMembers(roster.om) ? roster : { ...roster, om: DEFAULT_TEAM_MEMBER_ROLE_ROSTER.om };
  }
}

function hasRosterMembers(roster: ResourceOwnerRoster) {
  return Object.values(roster).some((owners) => (owners ?? []).length > 0);
}
