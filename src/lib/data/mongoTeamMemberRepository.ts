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
// MongoTeamMemberRepository.open을 쓰는 모든 화면(운영 상세·운영 현황, 캘린더, 관리자 DB,
// 가져오기(Notion·Sheets·Drive))이 이 목록으로 저장소를 연다. 공유 TEAM_READ_MODELS 자체를
// 넓히면 그 화면들과 무관한 다른 런타임의 저장소 준비 범위까지 함께 넓어져 버리므로,
// 이 리포지토리 전용 목록으로만 TeamUserDeparture를 추가한다 — 즉 위 화면들은 전부
// TeamUserDeparture 컬렉션이 없으면 VALIDATOR_NOT_READY로 실패한다.
const ROLE_ROSTER_MODELS = [...TEAM_READ_MODELS, "TeamUserDeparture"] as const;

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
      const store = new MongoOperationStore(options, ROLE_ROSTER_MODELS);
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
      // 퇴사자는 신규 배정 후보에서 제외한다. 이미 배정된 과거 회차의 OM/LD 표기는
      // 운영 데이터(OperationSession)에 그대로 남으므로 이 로스터 제외와 무관하다.
      // TeamUser 문서 자체에는 상태 필드를 두지 않는다(운영 Mongo 계약 유지).
      const [allUsers, departures] = await Promise.all([
        this.store.scan("TeamUser", { role: { $ne: null } }),
        this.store.scan("TeamUserDeparture")
      ]);
      const departedIds = new Set(departures.map(row => row.teamUserId as string));
      const users = allUsers.filter(user => !departedIds.has(user.id as string));
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
