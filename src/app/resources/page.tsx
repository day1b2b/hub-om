import { ResourceJudgmentPage } from "@/features/resources/ResourceJudgmentPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listNotionTeam1ResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { splitPersonNames } from "@/lib/data/personNames";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getTeamMemberRepository();
  const [operations, ownerRoster, notionTeam1Operations] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    listNotionTeam1ResourceOperations()
  ]);
  const resourceOperations =
    notionTeam1Operations.length > 0
      ? [...operations.filter((operation) => operation.sourceTeam !== "1팀"), ...notionTeam1Operations]
      : operations;
  const resourceOwnerRoster =
    notionTeam1Operations.length > 0
      ? {
          ...ownerRoster,
          "1팀": unique(notionTeam1Operations.flatMap((operation) => splitPersonNames(operation.om)))
        }
      : ownerRoster;

  return <ResourceJudgmentPage operations={resourceOperations} ownerRoster={resourceOwnerRoster} />;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
