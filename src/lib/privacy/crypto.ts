import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const PREFIX = "pii:v1:";
function key(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("PII keys must be base64-encoded 32-byte random keys.");
  const result = Buffer.from(value, "base64");
  if (result.length !== 32) throw new Error("Invalid PII key length.");
  return result;
}
function configuration() {
  let values: Record<string, string>;
  try { values = JSON.parse(process.env.PII_ENCRYPTION_KEYS ?? "{}"); }
  catch { throw new Error("Invalid PII_ENCRYPTION_KEYS configuration."); }
  const active = process.env.PII_ACTIVE_KEY_ID ?? "";
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(active) || !values || typeof values !== "object") throw new Error("PII_ACTIVE_KEY_ID is required.");
  const activeKey = key(values[active]);
  const indexKey = key(process.env.PII_INDEX_KEY);
  if (activeKey.equals(indexKey)) throw new Error("Encryption and lookup keys must be independent.");
  return { values, active, activeKey, indexKey };
}
export function assertPrivacyConfiguration() { configuration(); }
export function isEncrypted(value: unknown): value is string { return typeof value === "string" && value.startsWith(PREFIX); }
export function encrypt(value: string, context: string): string {
  const { active, activeKey } = configuration();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", activeKey, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`${PREFIX}${active}:${context}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${active}:${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}
export function decrypt(value: string, context: string): string {
  if (!isEncrypted(value)) {
    if (process.env.PII_ALLOW_PLAINTEXT_READS === "true") return value;
    throw new Error("Unencrypted personal data found; complete the PII migration before serving traffic.");
  }
  try {
    const parts = value.split(":");
    if (parts.length !== 6 || !/^[A-Za-z0-9_-]{16}$/.test(parts[3]) || !/^[A-Za-z0-9_-]{22}$/.test(parts[4]) || !/^[A-Za-z0-9_-]*$/.test(parts[5])) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key(configuration().values[parts[2]]), Buffer.from(parts[3], "base64url"), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(`${PREFIX}${parts[2]}:${context}`, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[5], "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Personal data decryption failed (key, context or integrity mismatch)."); }
}
export function blindIndex(value: string, context: string): string {
  return createHmac("sha256", configuration().indexKey).update(context).update("\0").update(value).digest("hex");
}
export function encodePrivateJson(value: unknown, context: string): string { return encrypt(JSON.stringify(value), context); }
export function decodePrivateJson(value: string, context: string): unknown { return JSON.parse(decrypt(value, context)); }
