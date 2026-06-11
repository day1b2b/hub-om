import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { mergeExternalResourceOperations } from "@/lib/data/externalResourceMerge";
import { listNotionResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
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
  const shouldReadExternalResources = process.env.OPERATION_DATA_SOURCE === "notion";
  const [operations, ownerRoster, externalResourceOperations, queryParams] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    shouldReadExternalResources ? listNotionResourceOperations() : Promise.resolve([]),
    searchParams
  ]);
  const allOperations = mergeExternalResourceOperations(operations, externalResourceOperations);
  const teamScope = resolveTeamScope(queryParams, session, ownerRoster);
  const operation = allOperations.find((candidate) => candidate.operationId === operationId);

  if (!operation) {
    notFound();
  }

  const scopedOperations = filterOperationsByTeamScope(allOperations, teamScope, ownerRoster);
  const relatedOperations = operation.courseId
    ? scopedOperations.filter((candidate) => candidate.courseId === operation.courseId)
    : [operation];

  return <OperationDetail operation={operation} relatedOperations={relatedOperations} teamScope={teamScope} />;
}
