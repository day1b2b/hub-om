import { OperationCreateForm } from "@/app/operations/new/OperationCreateForm";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { OperationSession, SourceTeam } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import type { ResourceOwnerRoster, TeamMemberRoleRoster } from "@/lib/data/teamMemberRepository";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { filterRoleRosterByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface NewOperationPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewOperationPage({ searchParams }: NewOperationPageProps) {
  const session = await requireWorkspaceSession();
  const operationRepository = getOperationRepository();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [operations, memberRoster, roleRoster, params] = await Promise.all([
    operationRepository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    teamMemberRepository.listRoleRosters(),
    searchParams
  ]);
  const teamScope = resolveTeamScope(params, session, memberRoster);
  const effectiveRoleRoster = mergeRoleRosters(roleRoster, buildRoleRosterFromOperations(operations));
  const scopedRoleRoster = filterRoleRosterByTeamScope(effectiveRoleRoster, teamScope);
  const today = formatDate(new Date());
  const personOptions = buildPersonOptions(scopedRoleRoster);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Operations" teamScope={teamScope} />

      <section className="content operations-page operation-create-page">
        <header className="page-header operation-create-header">
          <div>
            <h1>과정 작성</h1>
          </div>
          <div className="header-panel">
            <span>저장 위치</span>
            <strong>운영 DB</strong>
          </div>
        </header>

        <OperationCreateForm personOptions={personOptions} teamScope={teamScope} today={today} />
      </section>
    </main>
  );
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPersonOptions(roleRoster: TeamMemberRoleRoster) {
  return {
    ld: unique(Object.values(roleRoster.ld).flatMap((owners) => owners ?? [])),
    om: unique(Object.values(roleRoster.om).flatMap((owners) => owners ?? []))
  };
}

function buildRoleRosterFromOperations(operations: OperationSession[]): TeamMemberRoleRoster {
  return operations.reduce<TeamMemberRoleRoster>(
    (roster, operation) => {
      const sourceTeam = operation.sourceTeam;
      if (!isKnownSourceTeam(sourceTeam)) return roster;

      roster.om[sourceTeam] = unique([...(roster.om[sourceTeam] ?? []), ...splitPersonNames(operation.om, "")]);
      roster.ld[sourceTeam] = unique([...(roster.ld[sourceTeam] ?? []), ...splitPersonNames(operation.ld, "")]);
      return roster;
    },
    { ld: {}, om: {} }
  );
}

function mergeRoleRosters(primary: TeamMemberRoleRoster, fallback: TeamMemberRoleRoster): TeamMemberRoleRoster {
  return {
    ld: hasRosterMembers(primary.ld) ? primary.ld : fallback.ld,
    om: hasRosterMembers(primary.om) ? primary.om : fallback.om
  };
}

function hasRosterMembers(roster: ResourceOwnerRoster) {
  return Object.values(roster).some((owners) => (owners ?? []).length > 0);
}

function isKnownSourceTeam(sourceTeam: SourceTeam | undefined): sourceTeam is "1팀" | "2팀" {
  return sourceTeam === "1팀" || sourceTeam === "2팀";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
