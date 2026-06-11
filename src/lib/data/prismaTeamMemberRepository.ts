import type { SourceTeam as PrismaSourceTeam } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { ResourceOwnerRoster, TeamMemberRepository } from "./teamMemberRepository";
import type { SourceTeam } from "./operationTypes";

const SOURCE_TEAM_LABEL: Record<PrismaSourceTeam, SourceTeam> = {
  TEAM_1: "1팀",
  TEAM_2: "2팀",
  UNKNOWN: "미분류"
};

export class PrismaTeamMemberRepository implements TeamMemberRepository {
  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    const prisma = getPrismaClient();
    const members = await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: [{ sourceTeam: "asc" }, { displayOrder: "asc" }, { name: "asc" }]
    });

    return members.reduce<ResourceOwnerRoster>((roster, member) => {
      const sourceTeam = SOURCE_TEAM_LABEL[member.sourceTeam];
      roster[sourceTeam] = [...(roster[sourceTeam] ?? []), member.name];
      return roster;
    }, {});
  }
}
