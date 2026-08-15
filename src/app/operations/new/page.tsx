import { OperationCreateForm } from "@/app/operations/new/OperationCreateForm";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
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
  const personOptions = buildPersonOptions(scopedRoleRoster);
  const fromRequestId = firstParamValue(params.fromRequestId);
  const initialValues = fromRequestId ? await buildInitialValuesFromOmRequest(fromRequestId) : undefined;

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

        <OperationCreateForm initialValues={initialValues} personOptions={personOptions} teamScope={teamScope} />
      </section>
    </main>
  );
}

function firstParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function buildInitialValuesFromOmRequest(requestId: string) {
  const request = await getOmRequest(requestId);
  if (!request) return undefined;

  const firstSession = request.sessions[0];

  return {
    companyName: request.company,
    courseId: request.courseId,
    courseName: request.courseName,
    driveLink: request.driveLink,
    educationDays: firstSession?.duration,
    endDate: firstSession?.dateEnd || firstSession?.date,
    instructors: request.instructorName,
    onsiteRequired: request.onSiteOperation === "Y" ? "Y" : "N",
    operationDetail: request.syncupLink,
    region: firstSession?.location,
    startDate: firstSession?.date,
    timeText: firstSession?.timeStart && firstSession?.timeEnd ? `${firstSession.timeStart} ~ ${firstSession.timeEnd}` : undefined,
    trainingType: request.trainingType
  };
}
