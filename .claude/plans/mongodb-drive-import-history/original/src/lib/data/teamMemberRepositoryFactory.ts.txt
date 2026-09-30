import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { TeamMemberRepository } from "./teamMemberRepository";
import { LocalJsonTeamMemberRepository } from "./localJsonTeamMemberRepository";
import { getNotionTeamMemberRepository } from "./notionTeamMemberRepository";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";

export function getTeamMemberRepository(): TeamMemberRepository {
  const override = getDataRepositoryOverride("teamMembers");
  if (override) return override;
  const fallback = getFallbackTeamMemberRepository();

  if (process.env.OPERATION_DATA_SOURCE !== "notion") {
    return fallback;
  }

  return getNotionTeamMemberRepository(fallback);
}

export function getStoredTeamMemberRepository(): TeamMemberRepository {
  return getDataRepositoryOverride("teamMembers") ?? getFallbackTeamMemberRepository();
}

function getFallbackTeamMemberRepository(): TeamMemberRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL) {
    return new LocalJsonTeamMemberRepository();
  }

  return new PrismaTeamMemberRepository();
}
