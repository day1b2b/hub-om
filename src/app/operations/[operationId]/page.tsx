import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listNotionTeam1ResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { OperationSession } from "@/lib/data/operationTypes";

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
  const [operations, notionTeam1Operations] = await Promise.all([
    repository.listOperations(),
    listNotionTeam1ResourceOperations()
  ]);
  const allOperations = mergeNotionTeam1Operations(operations, notionTeam1Operations);
  const operation = allOperations.find((candidate) => candidate.operationId === operationId);

  if (!operation) {
    notFound();
  }

  const relatedOperations = operation.courseId
    ? allOperations.filter((candidate) => candidate.courseId === operation.courseId)
    : [operation];

  return <OperationDetail operation={operation} relatedOperations={relatedOperations} />;
}

function mergeNotionTeam1Operations(operations: OperationSession[], notionTeam1Operations: OperationSession[]) {
  if (notionTeam1Operations.length === 0) {
    return operations;
  }

  return [...operations.filter((operation) => operation.sourceTeam !== "1팀"), ...notionTeam1Operations];
}
