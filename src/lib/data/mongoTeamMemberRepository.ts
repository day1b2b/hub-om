import { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER } from "./defaultTeamMemberRoster";
import { MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, TEAM_READ_MODELS } from "./mongoReadStore";
import type { ResourceOwnerRoster, TeamMemberRepository, TeamMemberRoleRoster } from "./teamMemberRepository";
import type { SourceTeam } from "./operationTypes";

const teams = ["TEAM_1", "TEAM_2", "UNKNOWN"];
const roles = ["OM", "LD"];
const teamLabels: Record<string, SourceTeam> = { TEAM_1: "1팀", TEAM_2: "2팀", UNKNOWN: "미분류" };
function compare(left: unknown, right: unknown, enumOrder?: string[]): number {
  if (left == null) return right == null ? 0 : 1;
  if (right == null) return -1;
  if (enumOrder) return enumOrder.indexOf(String(left)) - enumOrder.indexOf(String(right));
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "ko");
}
function sourceTeam(value: unknown): SourceTeam { return value === "1팀" || value === "2팀" ? value : "미분류"; }

async function teamRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("TEAM_READ_FAILED");
  }
}

/** Parallel read adapter only. Production factory selection and permissions remain with callers.
 * Each method reads one bounded collection; no cross-method snapshot guarantee is added.
 */
export class MongoTeamMemberRepository implements TeamMemberRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoOperationOptions): Promise<MongoTeamMemberRepository> {
    return teamRead(async () => {
      const store = new MongoOperationStore(options, TEAM_READ_MODELS);
      await assertMongoReadStoreReady(store);
      return new MongoTeamMemberRepository(store);
    });
  }
  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    return teamRead(async () => {
      const members = await this.store.scan("Member", { isActive: true, role: null });
      if (members.length === 0) return DEFAULT_RESOURCE_OWNER_ROSTER;
      members.sort((a, b) => compare(a.sourceTeam, b.sourceTeam, teams) || compare(a.displayOrder, b.displayOrder) || compare(a.name, b.name));
      return members.reduce<ResourceOwnerRoster>((roster, member) => {
        if (member.sourceTeam === null) return roster;
        const team = teamLabels[member.sourceTeam as string];
        roster[team] = [...(roster[team] ?? []), member.name as string];
        return roster;
      }, {});
    });
  }
  async listRoleRosters(): Promise<TeamMemberRoleRoster> {
    return teamRead(async () => {
      const users = await this.store.scan("TeamUser", { role: { $ne: null } });
      if (users.length === 0) return DEFAULT_TEAM_MEMBER_ROLE_ROSTER;
      users.sort((a: MongoRow, b: MongoRow) => compare(a.role, b.role, roles) || compare(a.team, b.team) || compare(a.name, b.name));
      const roster = users.reduce<TeamMemberRoleRoster>((roster, user) => {
        const role = user.role === "OM" ? "om" : "ld";
        const team = sourceTeam(user.team);
        roster[role][team] = [...(roster[role][team] ?? []), user.name as string];
        return roster;
      }, { ld: {}, om: {} });
      return Object.values(roster.om).some(names => (names ?? []).length > 0) ? roster : { ...roster, om: DEFAULT_TEAM_MEMBER_ROLE_ROSTER.om };
    });
  }
}
