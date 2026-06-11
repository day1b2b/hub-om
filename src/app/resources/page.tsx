import { ResourceJudgmentPage } from "@/features/resources/ResourceJudgmentPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listNotionResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import type { OperationSession, SourceTeam } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import type { ResourceOwnerRoster } from "@/lib/data/teamMemberRepository";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getTeamMemberRepository();
  const shouldReadNotionResources = process.env.OPERATION_DATA_SOURCE !== "local";
  const [operations, ownerRoster, externalResourceOperations] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    shouldReadNotionResources ? listNotionResourceOperations() : Promise.resolve([])
  ]);
  const resourceOperations = mergeExternalResourceOperations(operations, externalResourceOperations);
  const resourceOwnerRoster = buildResourceOwnerRoster(ownerRoster, externalResourceOperations);

  return <ResourceJudgmentPage operations={resourceOperations} ownerRoster={resourceOwnerRoster} />;
}

function mergeExternalResourceOperations(operations: OperationSession[], externalOperations: OperationSession[]) {
  if (externalOperations.length === 0) {
    return operations;
  }

  const externalTeams = new Set(externalOperations.map((operation) => operation.sourceTeam).filter((team): team is SourceTeam => Boolean(team)));
  return [...operations.filter((operation) => !operation.sourceTeam || !externalTeams.has(operation.sourceTeam)), ...externalOperations];
}

function buildResourceOwnerRoster(ownerRoster: ResourceOwnerRoster, externalOperations: OperationSession[]) {
  if (externalOperations.length === 0) {
    return ownerRoster;
  }

  return externalOperations.reduce(
    (roster, operation) => {
      if (!operation.sourceTeam) return roster;

      roster[operation.sourceTeam] = unique([
        ...(roster[operation.sourceTeam] ?? []),
        ...splitPersonNames(operation.om)
      ]);
      return roster;
    },
    { ...ownerRoster }
  );
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
