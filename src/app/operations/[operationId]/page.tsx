import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { mergeExternalResourceOperations } from "@/lib/data/externalResourceMerge";
import { listNotionResourceOperations } from "@/lib/data/notionResourceOperationRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

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
