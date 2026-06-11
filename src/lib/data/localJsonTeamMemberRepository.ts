import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceTeam } from "./operationTypes";
import type { ResourceOwnerRoster, TeamMemberRepository } from "./teamMemberRepository";

interface LocalTeamMember {
  name?: string;
  sourceTeam?: SourceTeam;
}

interface LocalTeamMemberPayload {
  members?: LocalTeamMember[];
}

export class LocalJsonTeamMemberRepository implements TeamMemberRepository {
  constructor(private readonly fileName = "team-members.json") {}

  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    try {
      const localDir = path.resolve(process.cwd(), ".local");
      const localFileName = path.normalize(this.fileName.replace(/^\.local[\/\\]/, ""));
      const absolutePath = path.resolve(localDir, localFileName);

      if (!absolutePath.startsWith(`${localDir}${path.sep}`)) {
        return {};
      }

      const raw = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw) as LocalTeamMemberPayload;
      const members = parsed.members ?? [];

      return members.reduce<ResourceOwnerRoster>((roster, member) => {
        if (!member.name || !member.sourceTeam) return roster;

        roster[member.sourceTeam] = [...(roster[member.sourceTeam] ?? []), member.name.trim()];
        return roster;
      }, {});
    } catch {
      return {};
    }
  }
}
