import { OperationCreateForm } from "@/app/operations/new/OperationCreateForm";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { buildPersonOptions, buildRoleRosterFromOperations, mergeRoleRosters } from "@/lib/data/personOptions";
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
  const storageTarget = process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL ? "로컬 JSON" : "운영 DB";
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
            <strong>{storageTarget}</strong>
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
