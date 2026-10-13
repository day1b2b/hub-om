import { submitOperationSnapshot, OperationSubmissionConflictError, OperationSubmissionValidationError } from "@/features/operations/operationSubmission";
import { browserLegacyStorage, isLegacyRegistrationKey, legacyDraftKeys, type LegacyStorageAccess } from "./legacyDraftSources";

/**
 * Old (v1) registrations already carried an Idempotency-Key, so resending the exact request lets the
 * server answer "already created" or finish the creation. Nobody has to check the operations list by hand.
 * - "resolved": every old registration was confirmed, created now, rejected as invalid, or belongs to another account.
 * - "retry": a network/server failure; keep the plaintext so the next visit can resend it.
 */
export async function replayLegacyRegistrations(
  email: string, access: LegacyStorageAccess = browserLegacyStorage, request: typeof fetch = fetch
): Promise<"resolved" | "retry"> {
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    const storage = access(kind);
    for (const key of legacyDraftKeys(storage).filter(isLegacyRegistrationKey)) {
      const value = parseV1(storage.getItem(key));
      // Another account's or unreadable request: replaying it here could only create a wrong-owner copy.
      if (!value || value.actor.trim().toLowerCase() !== email.trim().toLowerCase()) continue;
      try {
        await submitOperationSnapshot({ version: 2, owner: "", expectedSubject: "", team: value.team, id: value.id, payloads: value.payloads, hasResultReport: value.hasResultReport }, request);
      } catch (error) {
        if (error instanceof OperationSubmissionValidationError) continue; // Server never started creation.
        if (error instanceof OperationSubmissionConflictError) continue; // 409: processed before.
        return "retry";
      }
    }
  }
  return "resolved";
}

type V1 = { actor: string; team: string; id: string; payloads: Record<string, string>[]; hasResultReport: "Y" | "N" };
function parseV1(raw: string | null): V1 | null {
  try {
    const value = JSON.parse(raw ?? "null") as V1 & { version?: number };
    if (!value || value.version !== 1 || typeof value.actor !== "string" || typeof value.team !== "string" ||
      typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.id) || !["Y", "N"].includes(value.hasResultReport) ||
      !Array.isArray(value.payloads) || !value.payloads.length ||
      value.payloads.some(body => !body || typeof body !== "object" || Array.isArray(body) || Object.values(body).some(item => typeof item !== "string"))) return null;
    return value;
  } catch { return null; }
}
