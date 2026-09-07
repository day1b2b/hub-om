import { createHash } from "node:crypto";
import type { OperationSession } from "@/lib/data/operationTypes";
/** 목록/상세 조회의 객체 키 순서와 무관하게 계획의 원본 회차를 식별한다. */
export function calendarOperationRevision(operation: OperationSession): string {
  return createHash("sha256").update(JSON.stringify(operation, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value
  )).digest("hex");
}
