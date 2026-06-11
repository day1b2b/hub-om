import { ResourceJudgmentPage } from "@/features/resources/ResourceJudgmentPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { mergeExternalResourceOperations } from "@/lib/data/externalResourceMerge";
import { listNotionResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import type { OperationSession } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import type { ResourceOwnerRoster } from "@/lib/data/teamMemberRepository";
import { filterOperationsByTeamScope, filterOwnerRosterByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface ResourcesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResourcesPage({ searchParams }: ResourcesPageProps) {
  const session = await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getTeamMemberRepository();
  const shouldReadNotionResources = process.env.OPERATION_DATA_SOURCE === "notion";
  const [operations, memberRoster, roleRoster, externalResourceOperations, params] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    teamMemberRepository.listRoleRosters(),
    shouldReadNotionResources ? listNotionResourceOperations() : Promise.resolve([]),
    searchParams
  ]);
  const resourceOperations = mergeExternalResourceOperations(operations, externalResourceOperations);
  const resourceOwnerRoster = buildResourceOwnerRoster(roleRoster.om, externalResourceOperations);
  const teamScope = resolveTeamScope(params, session, hasRosterMembers(memberRoster) ? memberRoster : resourceOwnerRoster);
  const scopedOperations = filterOperationsByTeamScope(resourceOperations, teamScope, resourceOwnerRoster);
  const scopedOwnerRoster = filterOwnerRosterByTeamScope(resourceOwnerRoster, teamScope);

  return <ResourceJudgmentPage operations={scopedOperations} ownerRoster={scopedOwnerRoster} teamScope={teamScope} />;
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

function hasRosterMembers(roster: ResourceOwnerRoster) {
  return Object.values(roster).some((owners) => (owners ?? []).length > 0);
}
