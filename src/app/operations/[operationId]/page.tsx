import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

interface OperationDetailPageProps {
  params: Promise<{
    operationId: string;
  }>;
}

export default async function OperationDetailPage({ params }: OperationDetailPageProps) {
  const { operationId } = await params;
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);

  if (!operation) {
    notFound();
  }

  return <OperationDetail operation={operation} />;
}
