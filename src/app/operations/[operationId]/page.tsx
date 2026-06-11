import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listNotionResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { OperationSession, SourceTeam } from "@/lib/data/operationTypes";

export const dynamic = "force-dynamic";

interface OperationDetailPageProps {
  params: Promise<{
    operationId: string;
  }>;
}

export default async function OperationDetailPage({ params }: OperationDetailPageProps) {
  await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const shouldReadExternalResources = process.env.OPERATION_DATA_SOURCE !== "local";
  const [operations, externalResourceOperations] = await Promise.all([
    repository.listOperations(),
    shouldReadExternalResources ? listNotionResourceOperations() : Promise.resolve([])
  ]);
  const allOperations = mergeExternalResourceOperations(operations, externalResourceOperations);
  const operation = allOperations.find((candidate) => candidate.operationId === operationId);

  if (!operation) {
    notFound();
  }

  const relatedOperations = operation.courseId
    ? allOperations.filter((candidate) => candidate.courseId === operation.courseId)
    : [operation];

  return <OperationDetail operation={operation} relatedOperations={relatedOperations} />;
}

function mergeExternalResourceOperations(operations: OperationSession[], externalOperations: OperationSession[]) {
  if (externalOperations.length === 0) {
    return operations;
  }

  const externalTeams = new Set(externalOperations.map((operation) => operation.sourceTeam).filter((team): team is SourceTeam => Boolean(team)));
  return [...operations.filter((operation) => !operation.sourceTeam || !externalTeams.has(operation.sourceTeam)), ...externalOperations];
}
