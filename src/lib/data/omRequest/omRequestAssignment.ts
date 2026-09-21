import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../prisma";
import type { OmRequest } from "./omRequestTypes";

const CREATE_ROUTE = "/api/om-request";
const TOKEN_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const creationSelect = { requestId: true, route: true, method: true, targetType: true, targetId: true, action: true } as const;
const operationSelect = { id: true, operationId: true, roundNo: true, omName: true, omUserId: true, operationStatus: true, updatedAt: true, deletedAt: true } as const;
type Creation = Prisma.ActivityChangeGetPayload<{ select: typeof creationSelect }>;
type AssignmentOperation = Prisma.OperationSessionGetPayload<{ select: typeof operationSelect }>;
type AssignmentState = Awaited<ReturnType<typeof readAssignmentState>>;

export class OmAssignmentConflict extends Error {
  constructor(message = "확인한 배정 대상이 변경되었거나 연결 근거가 부족합니다. 미리보기를 다시 확인해 주세요.") {
    super(message);
  }
}

function requireDatabase(): void {
  if (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL) {
    throw new OmAssignmentConflict("로컬 파일 모드에서는 배정을 안전하게 함께 저장할 수 없습니다. DB 검증 환경에서 확인해 주세요.");
  }
}
function normalizedInput(nextOm: string | null, actorEmail: string) {
  if (nextOm !== null && typeof nextOm !== "string") throw new OmAssignmentConflict("담당자 입력을 확인해 주세요.");
  const actor = typeof actorEmail === "string" ? actorEmail.trim().toLowerCase() : "";
  if (!actor) throw new OmAssignmentConflict("로그인 정보를 확인한 뒤 다시 시도해 주세요.");
  return { nextOm: nextOm?.trim() || null, actor };
}
function isCreation(entry: Creation, type: string): boolean {
  return entry.targetType === type && entry.route === CREATE_ROUTE && entry.method === "POST" &&
    entry.action === "create" && UUID.test(entry.requestId) && UUID.test(entry.targetId);
}
function expectedSessionCount(sessions: Prisma.JsonValue, totalSessions: number): number {
  if (!Array.isArray(sessions) || !Number.isInteger(totalSessions) || totalSessions < 1 || sessions.length !== totalSessions ||
    sessions.some((session) => !session || typeof session !== "object" || Array.isArray(session) || typeof session.date !== "string" || !session.date.trim())) {
    throw new OmAssignmentConflict("요청의 총 회차 수와 날짜가 입력된 일정 수가 일치하지 않습니다. 요청 일정을 확인해 주세요.");
  }
  return totalSessions;
}

/** Only creation metadata joins rounds. Audit values may be redacted and are never read. */
async function readAssignmentState(tx: Prisma.TransactionClient, existing: OmRequest) {
  const request = await tx.omRequest.findUnique({ where: { id: existing.id } });
  if (!request || request.team !== existing.team || request.assignedOm !== (existing.assignedOm ?? null) || request.operationId !== (existing.operationId ?? null)) {
    throw new OmAssignmentConflict("요청이 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
  }
  if (!request.operationId) throw new OmAssignmentConflict("연결 회차를 확인할 수 없어 변경하지 않았습니다. 요청과 운영현황의 연결을 먼저 확인해 주세요.");
  const count = expectedSessionCount(request.sessions, request.totalSessions);
  const representative = await tx.operationSession.findUnique({ where: { operationId: request.operationId }, select: operationSelect });
  if (!representative || representative.deletedAt) throw new OmAssignmentConflict("연결된 대표 회차가 없거나 삭제되었습니다. 배정을 변경하지 않았습니다.");
  const requestCreations = await tx.activityChange.findMany({ where: {
    targetType: "om_requests", targetId: request.id, route: CREATE_ROUTE, method: "POST", action: "create"
  }, select: creationSelect });
  if (requestCreations.length !== 1 || !isCreation(requestCreations[0], "om_requests") || requestCreations[0].targetId !== request.id) {
    throw new OmAssignmentConflict("요청의 생성 근거가 없거나 여러 건입니다. 전체 회차 연결을 확인해 주세요.");
  }
  const requestId = requestCreations[0].requestId;
  const batch = await tx.activityChange.findMany({ where: {
    requestId, route: CREATE_ROUTE, method: "POST", action: "create", targetType: { in: ["om_requests", "operation_sessions"] }
  }, select: creationSelect });
  // One HTTP creation batch must contain exactly this one request. No course/name expansion.
  const batchRequests = batch.filter((entry) => entry.targetType === "om_requests");
  if (batchRequests.length !== 1 || batchRequests[0].targetId !== request.id || batch.some((entry) => entry.requestId !== requestId || !isCreation(entry, entry.targetType) || !["om_requests", "operation_sessions"].includes(entry.targetType))) {
    throw new OmAssignmentConflict("회차 생성 근거가 서로 겹치거나 올바르지 않습니다. 연결을 확인해 주세요.");
  }
  const operationIds = batch.filter((entry) => entry.targetType === "operation_sessions").map((entry) => entry.targetId);
  if (operationIds.length !== count || new Set(operationIds).size !== count || !operationIds.includes(representative.id)) {
    throw new OmAssignmentConflict("요청한 회차 수와 확인된 연결 회차 수가 다릅니다. 누락된 연결을 확인해 주세요.");
  }
  const operations = await tx.operationSession.findMany({ where: { id: { in: operationIds } }, select: operationSelect });
  if (operations.length !== count || operations.some((operation) => operation.deletedAt || !operationIds.includes(operation.id)) || new Set(operations.map((op) => op.id)).size !== count) {
    throw new OmAssignmentConflict("연결 회차가 누락되었거나 삭제되었습니다. 전체 회차를 확인해 주세요.");
  }
  operations.sort((a, b) => a.id.localeCompare(b.id));
  return { request, operations };
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function signature(state: AssignmentState, nextOm: string | null, actor: string, expires: number): string {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("배정 확인 서명에 AUTH_SECRET이 필요합니다.");
  const { request, operations } = state;
  // OmRequest has no updatedAt column. Bind its current raw sessions and relevant values;
  // operation rows also bind updatedAt, so edits invalidate confirmation even after a revert.
  const snapshot = {
    request: { id: request.id, team: request.team, status: request.status, assignedOm: request.assignedOm,
      operationId: request.operationId, totalSessions: request.totalSessions, sessions: request.sessions, createdAt: request.createdAt },
    operations: operations.map(({ id, operationId, roundNo, omName, omUserId, operationStatus, updatedAt }) => ({ id, operationId, roundNo, omName, omUserId, operationStatus, updatedAt }))
  };
  return createHmac("sha256", secret).update(canonical({ purpose: "om-assignment-confirm-v1", expires, actor, nextOm, snapshot })).digest("hex");
}
function confirmToken(token: string, state: AssignmentState, nextOm: string | null, actor: string): void {
  if (typeof token !== "string" || !/^\d{13}\.[0-9a-f]{64}$/.test(token)) throw new OmAssignmentConflict("배정 미리보기를 확인한 뒤 다시 저장해 주세요.");
  const [timestamp, digest] = token.split(".");
  const expires = Number(timestamp);
  const now = Date.now();
  if (expires <= now || expires > now + TOKEN_TTL_MS) throw new OmAssignmentConflict("배정 확인 시간이 만료되었습니다. 미리보기를 다시 확인해 주세요.");
  if (!timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(signature(state, nextOm, actor, expires), "hex"))) throw new OmAssignmentConflict();
}
function serializationConflict(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2034") throw new OmAssignmentConflict("다른 사용자가 동시에 변경했습니다. 미리보기를 다시 확인해 주세요.");
  throw error;
}

/** The returned token contains only expiration and an HMAC, never names, email or IDs. */
export async function previewOmAssignment(existing: OmRequest, nextOm: string | null, actorEmail: string) {
  requireDatabase();
  const input = normalizedInput(nextOm, actorEmail);
  try {
    return await getPrismaClient().$transaction(async (tx) => {
      const state = await readAssignmentState(tx, existing);
      const expires = Date.now() + TOKEN_TTL_MS;
      return { token: `${expires}.${signature(state, input.nextOm, input.actor, expires)}`, count: state.operations.length,
        operations: state.operations.map(({ operationId, roundNo, omName, omUserId }) => ({ operationId, roundNo, omName, omUserId })),
        assignedOm: state.request.assignedOm, nextOm: input.nextOm };
    }, { isolationLevel: "Serializable" });
  } catch (error) { return serializationConflict(error); }
}
function nextStatus(operation: AssignmentOperation, nextOm: string | null) {
  if (nextOm && operation.operationStatus === "ASSIGNMENT_NEEDED") return "ASSIGNMENT_PLANNED" as const;
  if (!nextOm && operation.operationStatus === "ASSIGNMENT_PLANNED") return "ASSIGNMENT_NEEDED" as const;
  return operation.operationStatus;
}

/** Explicit confirmation replaces every linked round's manual name/id assignment atomically. */
export async function assignOmRequestAtomically(existing: OmRequest, nextOm: string | null, actorEmail: string, confirmationToken: string): Promise<{ updated: OmRequest; operationIds: string[] }> {
  requireDatabase();
  const input = normalizedInput(nextOm, actorEmail);
  try {
    return await getPrismaClient().$transaction(async (tx) => {
      const state = await readAssignmentState(tx, existing);
      confirmToken(confirmationToken, state, input.nextOm, input.actor);
      const changed = state.operations.filter((operation) => operation.omName !== input.nextOm || operation.omUserId !== null || operation.operationStatus !== nextStatus(operation, input.nextOm));
      for (const operation of changed) {
        await tx.operationSession.update({ where: { id: operation.id }, data: { omName: input.nextOm, omUserId: null, operationStatus: nextStatus(operation, input.nextOm) } });
      }
      const status = input.nextOm ? "배정완료" as const : "배정필요" as const;
      if (state.request.assignedOm !== input.nextOm || state.request.status !== status) {
        await tx.omRequest.update({ where: { id: state.request.id }, data: { assignedOm: input.nextOm, status } });
      }
      return { updated: { ...existing, assignedOm: input.nextOm ?? undefined, status }, operationIds: changed.map((operation) => operation.operationId) };
    }, { isolationLevel: "Serializable" });
  } catch (error) { return serializationConflict(error); }
}
