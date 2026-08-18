import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { mergeExternalResourceOperations } from "@/lib/data/externalResourceMerge";
import { LocalJsonOperationRepository } from "@/lib/data/localJsonOperationRepository";
import { isSameCourse, normalizeCourseId } from "@/lib/data/operationCalculations";
import { readOperationCollaboration } from "@/lib/data/operationCollaboration";
import { hasNotionResourceConfig, listNotionResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { OperationSession } from "@/lib/data/operationTypes";
import { buildPersonOptions, buildRoleRosterFromOperations, mergeRoleRosters } from "@/lib/data/personOptions";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { filterOperationsByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface OperationDetailPageProps {
  params: Promise<{
    operationId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OperationDetailPage({ params, searchParams }: OperationDetailPageProps) {
  const session = await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const shouldReadExternalResources = hasNotionResourceConfig();
  const [operations, ownerRoster, roleRoster, queryParams] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    teamMemberRepository.listRoleRosters(),
    searchParams
  ]);
  const personOptions = buildPersonOptions(mergeRoleRosters(roleRoster, buildRoleRosterFromOperations(operations)));
  let operation = operations.find((candidate) => candidate.operationId === operationId);
  let allOperations = operations;

  if (shouldReadExternalResources && (!operation || isNotionResourceOperationId(operationId))) {
    const externalResourceOperations = await listNotionResourceOperations();
    allOperations = mergeExternalResourceOperations(operations, externalResourceOperations);
    operation = allOperations.find((candidate) => candidate.operationId === operationId);
  }

  if (!operation && isExcelImportOperationId(operationId)) {
    const localOperations = await new LocalJsonOperationRepository().listOperations();
    operation = localOperations.find((candidate) => candidate.operationId === operationId);
    allOperations = mergeOperationLists(allOperations, localOperations);
  }

  const teamScope = resolveTeamScope(queryParams, session, ownerRoster);

  if (!operation) {
    notFound();
  }

  const scopedOperations = filterOperationsByTeamScope(allOperations, teamScope, ownerRoster);
  const relatedOperations = scopedOperations.filter((candidate) => isSameCourse(candidate, operation));
  const sameCourseIdOperations = operation.courseId
    ? scopedOperations.filter(
        (candidate) => normalizeCourseId(candidate.courseId) === normalizeCourseId(operation.courseId)
      )
    : [];
  const collaboration = await readOperationCollaboration(operation, {
    gmailOAuthAccessToken: session.googleAccessToken
  });

  return (
    <OperationDetail
      collaboration={collaboration}
      extraTools={listCustomTools()}
      operation={operation}
      personOptions={personOptions}
      relatedOperations={relatedOperations}
      sameCourseIdOperations={sameCourseIdOperations}
      teamScope={teamScope}
    />
  );
}

function isNotionResourceOperationId(operationId: string) {
  return operationId.startsWith("NOTION-");
}

function isExcelImportOperationId(operationId: string) {
  return operationId.startsWith("excel-");
}

function mergeOperationLists(...operationLists: OperationSession[][]) {
  const operations = new Map<string, OperationSession>();

  for (const operationList of operationLists) {
    for (const operation of operationList) {
      operations.set(operation.operationId, operation);
    }
  }

  return [...operations.values()];
}
