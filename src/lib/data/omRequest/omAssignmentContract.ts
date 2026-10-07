import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { OmRequest } from "./omRequestTypes";

const CREATE_ROUTE = "/api/om-request";
export const REPAIR_LINK_ROUTE = "/maintenance/om-request-session-repair";
export const TOKEN_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const creationSelect = { requestId: true, route: true, method: true, targetType: true, targetId: true, action: true } as const;
export const operationSelect = { id: true, operationId: true, roundNo: true, omName: true, omUserId: true, operationStatus: true, updatedAt: true, deletedAt: true } as const;
export type Creation = Prisma.ActivityChangeGetPayload<{ select: typeof creationSelect }>;
export type AssignmentOperation = Prisma.OperationSessionGetPayload<{ select: typeof operationSelect }>;
type AssignmentState = Awaited<ReturnType<typeof readAssignmentState>>;

export class OmAssignmentConflict extends Error {
  constructor(message = "확인한 배정 대상이 변경되었거나 연결 근거가 부족합니다. 미리보기를 다시 확인해 주세요.") {
    super(message);
  }
}

export type AssignmentRequest = Prisma.OmRequestGetPayload<Record<string, never>>;
export type CreationFilter = { targetType?: string | { in: string[] }; targetId?: string; requestId?: string; route: string; method: string; action: string };
export interface OmAssignmentTransaction {
  getRequest(id: string): Promise<AssignmentRequest | null>;
  getOperation(operationId: string): Promise<AssignmentOperation | null>;
  listCreations(filter: CreationFilter): Promise<Creation[]>;
  getOperations(ids: string[]): Promise<AssignmentOperation[]>;
  updateOperation(id: string, patch: { omName: string | null; omUserId: null; operationStatus: AssignmentOperation["operationStatus"] }): Promise<void>;
  updateRequest(id: string, patch: { assignedOm: string | null; status: string }): Promise<void>;
}
export function normalizedInput(nextOm: string | null, actorEmail: string) {
  if (nextOm !== null && typeof nextOm !== "string") throw new OmAssignmentConflict("담당자 입력을 확인해 주세요.");
  const actor = typeof actorEmail === "string" ? actorEmail.trim().toLowerCase() : "";
  if (!actor) throw new OmAssignmentConflict("로그인 정보를 확인한 뒤 다시 시도해 주세요.");
  return { nextOm: nextOm?.trim() || null, actor };
}
function isCreation(entry: Creation, type: string, route = CREATE_ROUTE, action = "create"): boolean {
  return entry.targetType === type && entry.route === route && entry.method === "POST" &&
    entry.action === action && UUID.test(entry.requestId) && UUID.test(entry.targetId);
}
function expectedSessionCount(sessions: Prisma.JsonValue, totalSessions: number): number {
  if (!Array.isArray(sessions) || !Number.isInteger(totalSessions) || totalSessions < 1 || sessions.length !== totalSessions ||
    sessions.some((session) => !session || typeof session !== "object" || Array.isArray(session) || typeof session.date !== "string" || !session.date.trim())) {
    throw new OmAssignmentConflict("요청의 총 회차 수와 날짜가 입력된 일정 수가 일치하지 않습니다. 요청 일정을 확인해 주세요.");
  }
  return totalSessions;
}

/** Only creation metadata joins rounds. Audit values may be redacted and are never read. */
export async function readAssignmentState(tx: OmAssignmentTransaction, existing: OmRequest) {
  const request = await tx.getRequest(existing.id);
  if (!request || request.team !== existing.team || request.assignedOm !== (existing.assignedOm ?? null) || request.operationId !== (existing.operationId ?? null)) {
    throw new OmAssignmentConflict("요청이 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
  }
  if (!request.operationId) throw new OmAssignmentConflict("연결 회차를 확인할 수 없어 변경하지 않았습니다. 요청과 운영현황의 연결을 먼저 확인해 주세요.");
  const count = expectedSessionCount(request.sessions, request.totalSessions);
  const representative = await tx.getOperation(request.operationId);
  if (!representative || representative.deletedAt) throw new OmAssignmentConflict("연결된 대표 회차가 없거나 삭제되었습니다. 배정을 변경하지 않았습니다.");
  const repairs = await tx.listCreations({
    targetType: "om_requests", targetId: request.id, route: REPAIR_LINK_ROUTE, method: "POST", action: "link"
  });
  // An approved repair records the complete explicit set under its own batch.
  // Never forge historical creation metadata or infer siblings by course/name.
  const route = repairs.length ? REPAIR_LINK_ROUTE : CREATE_ROUTE;
  const action = repairs.length ? "link" : "create";
  const requestCreations = repairs.length ? repairs : await tx.listCreations({
    targetType: "om_requests", targetId: request.id, route: CREATE_ROUTE, method: "POST", action: "create"
  });
  if (requestCreations.length !== 1 || !isCreation(requestCreations[0], "om_requests", route, action) || requestCreations[0].targetId !== request.id) {
    throw new OmAssignmentConflict("요청의 생성 근거가 없거나 여러 건입니다. 전체 회차 연결을 확인해 주세요.");
  }
  const requestId = requestCreations[0].requestId;
  const batch = await tx.listCreations({
    requestId, route, method: "POST", action, targetType: { in: ["om_requests", "operation_sessions"] }
  });
  // One HTTP creation batch must contain exactly this one request. No course/name expansion.
  const batchRequests = batch.filter((entry) => entry.targetType === "om_requests");
  if (batchRequests.length !== 1 || batchRequests[0].targetId !== request.id || batch.some((entry) => entry.requestId !== requestId || !isCreation(entry, entry.targetType, route, action) || !["om_requests", "operation_sessions"].includes(entry.targetType))) {
    throw new OmAssignmentConflict("회차 생성 근거가 서로 겹치거나 올바르지 않습니다. 연결을 확인해 주세요.");
  }
  let operationIds = batch.filter((entry) => entry.targetType === "operation_sessions").map((entry) => entry.targetId);
  // Early Mongo cutover requests can have the request creation audit while the
  // linked operation creation audit is absent. For an exact one-session request,
  // the persisted representative link is the complete set and is safe to use.
  // Never infer siblings for multi-session or partially audited requests.
  if (route === CREATE_ROUTE && operationIds.length === 0 && count === 1) operationIds = [representative.id];
  if (operationIds.length !== count || new Set(operationIds).size !== count || !operationIds.includes(representative.id)) {
    throw new OmAssignmentConflict("요청한 회차 수와 확인된 연결 회차 수가 다릅니다. 누락된 연결을 확인해 주세요.");
  }
  const operations = await tx.getOperations(operationIds);
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
export function signature(state: AssignmentState, nextOm: string | null, actor: string, expires: number): string {
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
export function confirmToken(token: string, state: AssignmentState, nextOm: string | null, actor: string): void {
  if (typeof token !== "string" || !/^\d{13}\.[0-9a-f]{64}$/.test(token)) throw new OmAssignmentConflict("배정 미리보기를 확인한 뒤 다시 저장해 주세요.");
  const [timestamp, digest] = token.split(".");
  const expires = Number(timestamp);
  const now = Date.now();
  if (expires <= now || expires > now + TOKEN_TTL_MS) throw new OmAssignmentConflict("배정 확인 시간이 만료되었습니다. 미리보기를 다시 확인해 주세요.");
  if (!timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(signature(state, nextOm, actor, expires), "hex"))) throw new OmAssignmentConflict();
}
export function nextStatus(operation: AssignmentOperation, nextOm: string | null) {
  if (nextOm && operation.operationStatus === "ASSIGNMENT_NEEDED") return "ASSIGNMENT_PLANNED" as const;
  if (!nextOm && operation.operationStatus === "ASSIGNMENT_PLANNED") return "ASSIGNMENT_NEEDED" as const;
  return operation.operationStatus;
}

export async function previewAssignment(tx: OmAssignmentTransaction, existing: OmRequest, nextOm: string | null, actor: string) {
  const state = await readAssignmentState(tx, existing);
  const expires = Date.now() + TOKEN_TTL_MS;
  return { token: `${expires}.${signature(state, nextOm, actor, expires)}`, count: state.operations.length,
    operations: state.operations.map(({ operationId, roundNo, omName, omUserId }) => ({ operationId, roundNo, omName, omUserId })),
    assignedOm: state.request.assignedOm, nextOm };
}
export async function confirmAssignment(tx: OmAssignmentTransaction, existing: OmRequest, nextOm: string | null, actor: string, token: string): Promise<{ updated: OmRequest; operationIds: string[] }> {
  const state = await readAssignmentState(tx, existing);
  confirmToken(token, state, nextOm, actor);
  const changed = state.operations.filter(operation => operation.omName !== nextOm || operation.omUserId !== null || operation.operationStatus !== nextStatus(operation, nextOm));
  for (const operation of changed) await tx.updateOperation(operation.id, { omName: nextOm, omUserId: null, operationStatus: nextStatus(operation, nextOm) });
  const status = nextOm ? "배정완료" as const : "배정필요" as const;
  if (state.request.assignedOm !== nextOm || state.request.status !== status) await tx.updateRequest(state.request.id, { assignedOm: nextOm, status });
  return { updated: { ...existing, assignedOm: nextOm ?? undefined, status }, operationIds: changed.map(operation => operation.operationId) };
}
export interface OmAssignmentRepository {
  previewOmAssignment(existing: OmRequest, nextOm: string | null, actorEmail: string): Promise<Awaited<ReturnType<typeof previewAssignment>>>;
  assignOmRequestAtomically(existing: OmRequest, nextOm: string | null, actorEmail: string, token: string): Promise<{ updated: OmRequest; operationIds: string[] }>;
}
