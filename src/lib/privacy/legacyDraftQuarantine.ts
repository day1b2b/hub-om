/** Browser-safe wire format. No source metadata or claimed owner is public. */
export interface LegacyDraftSnapshot {
  version: 1;
  source: "localStorage" | "sessionStorage";
  storageKey: string;
  rawValue: string;
  nonce: string;
}
export interface LegacyDraftQuarantineRecord {
  envelope: { version: 1; id: string; keyId: string; iv: string; tag: string; ciphertext: string };
  receipt: string;
}
export const LEGACY_DRAFT_MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const LEGACY_DRAFT_MAX_REQUEST_BYTES = 24 * 1024 * 1024;
export const legacyDraftUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isLegacyDraftQuarantineRecord(value: unknown): value is LegacyDraftQuarantineRecord {
  if (!object(value) || Object.keys(value).sort().join() !== "envelope,receipt" || !object(value.envelope)) return false;
  const e = value.envelope;
  return Object.keys(e).sort().join() === "ciphertext,id,iv,keyId,tag,version"
    && e.version === 1 && typeof e.id === "string" && legacyDraftUuid.test(e.id)
    && typeof e.keyId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(e.keyId)
    && typeof e.iv === "string" && /^[A-Za-z0-9_-]{16}$/.test(e.iv)
    && typeof e.tag === "string" && /^[A-Za-z0-9_-]{22}$/.test(e.tag)
    && typeof e.ciphertext === "string" && e.ciphertext.length > 0
    && e.ciphertext.length <= Math.ceil(LEGACY_DRAFT_MAX_SNAPSHOT_BYTES * 4 / 3)
    && /^[A-Za-z0-9_-]+$/.test(e.ciphertext)
    && typeof value.receipt === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.receipt);
}
