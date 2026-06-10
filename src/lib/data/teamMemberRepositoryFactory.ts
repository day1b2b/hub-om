import { EmptyTeamMemberRepository } from "./teamMemberRepository";
import type { TeamMemberRepository } from "./teamMemberRepository";
import { LocalJsonTeamMemberRepository } from "./localJsonTeamMemberRepository";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";

export function getTeamMemberRepository(): TeamMemberRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local") {
    return new LocalJsonTeamMemberRepository();
  }

  if (!process.env.DATABASE_URL) {
    return new EmptyTeamMemberRepository();
  }

  return new PrismaTeamMemberRepository();
}
