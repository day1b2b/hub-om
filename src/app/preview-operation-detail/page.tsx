import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { LocalJsonOperationRepository } from "@/lib/data/localJsonOperationRepository";
import { readOperationCollaboration } from "@/lib/data/operationCollaboration";

export const dynamic = "force-dynamic";

export default async function PreviewOperationDetailPage() {
  const repository = new LocalJsonOperationRepository();
  const operations = await repository.listOperations();
  const operation = operations.find((candidate) => candidate.operationId === "preview-op-1");

  if (!operation) {
    notFound();
  }

  const relatedOperations = operations.filter((candidate) => candidate.courseId === operation.courseId);
  const collaboration = await readOperationCollaboration(operation, {});

  return (
    <OperationDetail
      collaboration={collaboration}
      operation={operation}
      relatedOperations={relatedOperations}
      teamScope="both"
    />
  );
}
