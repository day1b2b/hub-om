import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { LocalJsonOperationRepository } from "@/lib/data/localJsonOperationRepository";
import { readOperationCollaboration } from "@/lib/data/operationCollaboration";
import { isSameCourse, normalizeCourseId } from "@/lib/data/operationCalculations";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";

export const dynamic = "force-dynamic";

export default async function PreviewOperationDetailPage() {
  const repository = new LocalJsonOperationRepository();
  const operations = await repository.listOperations();
  const operation = operations.find((candidate) => candidate.operationId === "preview-op-1");

  if (!operation) {
    notFound();
  }

  const relatedOperations = operations.filter((candidate) => isSameCourse(candidate, operation));
  const sameCourseIdOperations = operations.filter(
    (candidate) => normalizeCourseId(candidate.courseId) === normalizeCourseId(operation.courseId)
  );
  const collaboration = await readOperationCollaboration(operation, {});

  return (
    <OperationDetail
      collaboration={collaboration}
      extraTools={listCustomTools()}
      operation={operation}
      relatedOperations={relatedOperations}
      sameCourseIdOperations={sameCourseIdOperations}
      teamScope="both"
    />
  );
}
