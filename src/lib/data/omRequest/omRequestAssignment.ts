import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../prisma";
import { getDataRepositoryOverride } from "../dataRepositoryContext";
import type { OmRequest } from "./omRequestTypes";
import { OmAssignmentConflict, normalizedInput, previewAssignment, confirmAssignment, creationSelect, operationSelect, type OmAssignmentTransaction } from "./omAssignmentContract";
export { OmAssignmentConflict } from "./omAssignmentContract";

function requireDatabase(): void {
  if (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL) {
    throw new OmAssignmentConflict("로컬 파일 모드에서는 배정을 안전하게 함께 저장할 수 없습니다. DB 검증 환경에서 확인해 주세요.");
  }
}
function port(tx: Prisma.TransactionClient): OmAssignmentTransaction {
  return {
    getRequest: id => tx.omRequest.findUnique({ where: { id } }),
    getOperation: operationId => tx.operationSession.findUnique({ where: { operationId }, select: operationSelect }),
    listCreations: where => tx.activityChange.findMany({ where, select: creationSelect }),
    getOperations: ids => tx.operationSession.findMany({ where: { id: { in: ids } }, select: operationSelect }),
    async updateOperation(id, data) { await tx.operationSession.update({ where: { id }, data }); },
    async updateRequest(id, data) { await tx.omRequest.update({ where: { id }, data }); }
  };
}
function serializationConflict(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2034") throw new OmAssignmentConflict("다른 사용자가 동시에 변경했습니다. 미리보기를 다시 확인해 주세요.");
  throw error;
}
export async function previewOmAssignment(existing: OmRequest, nextOm: string | null, actorEmail: string) {
  const override = getDataRepositoryOverride("omAssignment");
  if (override) return override.previewOmAssignment(existing, nextOm, actorEmail);
  requireDatabase();
  const input = normalizedInput(nextOm, actorEmail);
  try { return await getPrismaClient().$transaction(tx => previewAssignment(port(tx), existing, input.nextOm, input.actor), { isolationLevel: "Serializable" }); }
  catch (error) { return serializationConflict(error); }
}
export async function assignOmRequestAtomically(existing: OmRequest, nextOm: string | null, actorEmail: string, confirmationToken: string): Promise<{ updated: OmRequest; operationIds: string[] }> {
  const override = getDataRepositoryOverride("omAssignment");
  if (override) return override.assignOmRequestAtomically(existing, nextOm, actorEmail, confirmationToken);
  requireDatabase();
  const input = normalizedInput(nextOm, actorEmail);
  try { return await getPrismaClient().$transaction(tx => confirmAssignment(port(tx), existing, input.nextOm, input.actor, confirmationToken), { isolationLevel: "Serializable" }); }
  catch (error) { return serializationConflict(error); }
}
