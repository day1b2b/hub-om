import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isLegacyDraftQuarantineRecord, legacyDraftUuid, LEGACY_DRAFT_MAX_SNAPSHOT_BYTES, type LegacyDraftSnapshot, type LegacyDraftQuarantineRecord } from "./legacyDraftQuarantine";

type Env = Record<string, string | undefined>;
const DOMAIN = "hub-om/legacy-quarantine/v1";
export class QuarantineInputError extends Error {}
export class QuarantineVerificationError extends Error {}
export function validateLegacyDraftSnapshot(value: unknown): LegacyDraftSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QuarantineInputError();
  const s = value as LegacyDraftSnapshot;
  if (Object.keys(s).sort().join() !== "nonce,rawValue,source,storageKey,version" || s.version !== 1
    || typeof s.storageKey !== "string" || s.storageKey.length > 4096 || typeof s.rawValue !== "string"
    || typeof s.nonce !== "string" || !legacyDraftUuid.test(s.nonce)) throw new QuarantineInputError();
  const prefixes = ["localStorage", "sessionStorage"].includes(s.source) ? ["hub-om:lecture-note-draft:", "hub-om:issue-review-draft:", "hub-om:drive-import-draft:", "hub-om:operation-submission:v1:"] : [];
  if (!prefixes.some(p => s.storageKey.startsWith(p) && s.storageKey.length > p.length)) throw new QuarantineInputError();
  const canonical = { version: 1 as const, source: s.source, storageKey: s.storageKey, rawValue: s.rawValue, nonce: s.nonce };
  if (Buffer.byteLength(JSON.stringify(canonical)) > LEGACY_DRAFT_MAX_SNAPSHOT_BYTES) throw new QuarantineInputError();
  return canonical;
}
function decode(value: string): Buffer {
  const b = Buffer.from(value, "base64url");
  if (b.toString("base64url") !== value) throw new QuarantineVerificationError();
  return b;
}
function keys(env: Env) {
  const raw = env.BROWSER_DRAFT_QUARANTINE_KEYS;
  if (!raw || raw.length > 4096) throw new Error("Quarantine configuration unavailable");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Quarantine configuration unavailable");
  const entries = Object.entries(parsed);
  if (!entries.length || entries.length > 8) throw new Error("Quarantine configuration unavailable");
  const prohibited: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (/^(AUTH_SECRET(?:_\d+)?|NEXTAUTH_SECRET|PII_INDEX_KEY|BROWSER_DRAFT_OWNER_KEY)$/.test(name)) prohibited.push(value);
    if (["BROWSER_DRAFT_MASTER_KEYS", "PII_ENCRYPTION_KEYS"].includes(name)) {
      try { prohibited.push(...Object.values(JSON.parse(value)).filter((v): v is string => typeof v === "string")); } catch { throw new Error("Quarantine configuration unavailable"); }
    }
  }
  const result = new Map<string, Buffer>();
  for (const [id, value] of entries) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof value !== "string") throw new Error("Quarantine configuration unavailable");
    const key = Buffer.from(value, "base64");
    if (key.length !== 32 || key.toString("base64") !== value
      || [...result.values()].some(k => k.equals(key))
      || prohibited.some(p => p === value || Buffer.from(p, "base64").equals(key) || Buffer.from(p).equals(key))) throw new Error("Quarantine configuration unavailable");
    result.set(id, key);
  }
  const active = env.BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID;
  if (!active || !result.has(active)) throw new Error("Quarantine configuration unavailable");
  return { result, active };
}
function derived(root: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", root, DOMAIN, purpose, 32));
}
function aad(e: LegacyDraftQuarantineRecord["envelope"]): string { return JSON.stringify([DOMAIN, e.version, e.keyId, e.id]); }
function receipt(root: Buffer, e: LegacyDraftQuarantineRecord["envelope"], subject: string, s: LegacyDraftSnapshot): string {
  return createHmac("sha256", derived(root, "receipt")).update(JSON.stringify([DOMAIN, aad(e), e.iv, e.tag, e.ciphertext, subject, s])).digest("base64url");
}
function validateSubject(subject: string) {
  if (!/^google:[^\s\x00-\x1f\x7f]{1,255}$/.test(subject)) throw new QuarantineInputError();
}
/** Offline recovery primitive only; never expose through an HTTP decrypt endpoint. */
export function recoverLegacyDraftQuarantine(record: LegacyDraftQuarantineRecord, env: Env = process.env): LegacyDraftSnapshot {
  if (!isLegacyDraftQuarantineRecord(record)) throw new QuarantineInputError();
  const root = keys(env).result.get(record.envelope.keyId);
  if (!root) throw new Error("Quarantine key unavailable");
  const e = record.envelope;
  try {
    const decipher = createDecipheriv("aes-256-gcm", derived(root, "encryption"), decode(e.iv));
    decipher.setAAD(Buffer.from(aad(e)));
    decipher.setAuthTag(decode(e.tag));
    return validateLegacyDraftSnapshot(JSON.parse(Buffer.concat([decipher.update(decode(e.ciphertext)), decipher.final()]).toString("utf8")));
  } catch { throw new QuarantineVerificationError(); }
}
export function sealLegacyDraftQuarantine(value: unknown, subject: string, env: Env = process.env): LegacyDraftQuarantineRecord {
  validateSubject(subject);
  const snapshot = validateLegacyDraftSnapshot(value);
  const { result, active } = keys(env);
  const root = result.get(active)!;
  const e = { version: 1 as const, id: randomUUID(), keyId: active, iv: randomBytes(12).toString("base64url"), tag: "", ciphertext: "" };
  const cipher = createCipheriv("aes-256-gcm", derived(root, "encryption"), decode(e.iv));
  cipher.setAAD(Buffer.from(aad(e)));
  e.ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), "utf8"), cipher.final()]).toString("base64url");
  e.tag = cipher.getAuthTag().toString("base64url");
  const record = { envelope: e, receipt: receipt(root, e, subject, snapshot) };
  if (JSON.stringify(recoverLegacyDraftQuarantine(record, env)) !== JSON.stringify(snapshot)) throw new QuarantineVerificationError();
  return record;
}
export function verifyLegacyDraftQuarantine(record: unknown, value: unknown, subject: string, env: Env = process.env) {
  validateSubject(subject);
  const snapshot = validateLegacyDraftSnapshot(value);
  if (!isLegacyDraftQuarantineRecord(record)) throw new QuarantineInputError();
  const root = keys(env).result.get(record.envelope.keyId);
  if (!root) throw new Error("Quarantine key unavailable");
  const expected = decode(receipt(root, record.envelope, subject, snapshot));
  const actual = decode(record.receipt);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new QuarantineVerificationError();
  if (JSON.stringify(recoverLegacyDraftQuarantine(record, env)) !== JSON.stringify(snapshot)) throw new QuarantineVerificationError();
  return { verified: true as const, id: record.envelope.id, nonce: snapshot.nonce };
}
