import { EmptyTeamMemberRepository } from "./teamMemberRepository";
import type { TeamMemberRepository } from "./teamMemberRepository";
import { LocalJsonTeamMemberRepository } from "./localJsonTeamMemberRepository";
import { getNotionTeamMemberRepository } from "./notionTeamMemberRepository";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";

export function getTeamMemberRepository(): TeamMemberRepository {
  const fallback = getFallbackTeamMemberRepository();

  if (process.env.OPERATION_DATA_SOURCE === "local") {
    return fallback;
  }

  return getNotionTeamMemberRepository(fallback);
}

function getFallbackTeamMemberRepository(): TeamMemberRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local") {
    return new LocalJsonTeamMemberRepository();
  }

  if (!process.env.DATABASE_URL) {
    return new EmptyTeamMemberRepository();
  }

  return new PrismaTeamMemberRepository();
}
