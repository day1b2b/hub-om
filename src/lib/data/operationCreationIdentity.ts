import { createHash } from "node:crypto";

/** 서버가 인증된 사용자·API 경로·요청 키로 만든 값. 클라이언트 operationId는 받지 않는다. */
export interface OperationCreationIdentity {
  scope: string;
  fingerprint: string;
}

export class OperationCreationConflict extends Error {
  constructor() {
    super("이미 처리한 등록 요청과 내용이 다르거나 해당 회차가 삭제되었습니다. 운영현황을 확인해주세요.");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function operationCreationIdentity(
  key: string | null, actorEmail: string | null | undefined, route: string, body: unknown
): OperationCreationIdentity | undefined {
  if (key === null) return undefined;
  if (!/^[a-zA-Z0-9:_-]{16,128}$/.test(key) || !actorEmail?.trim()) {
    throw new Error("등록 요청 키와 로그인 정보를 확인해주세요.");
  }
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return { scope: hash(JSON.stringify([actorEmail.trim().toLowerCase(), route, key])), fingerprint: hash(stableJson(body)) };
}

export function creationOperationPrefix(identity: OperationCreationIdentity): string {
  if (!/^[a-f0-9]{64}$/.test(identity.scope) || !/^[a-f0-9]{64}$/.test(identity.fingerprint)) {
    throw new Error("유효하지 않은 등록 요청입니다.");
  }
  return `manual-request-${identity.scope}-`;
}

export function creationOperationId(identity: OperationCreationIdentity): string {
  return `${creationOperationPrefix(identity)}${identity.fingerprint}`;
}

/** 같은 요청 키는 내용을 바꾸거나 삭제된 회차를 복원하는 용도로 재사용하지 않는다. */
export function assertCreationReplay(identity: OperationCreationIdentity, existing: { operationId: string; deletedAt?: unknown }): void {
  if (existing.operationId !== creationOperationId(identity) || existing.deletedAt) throw new OperationCreationConflict();
}
