/** Isolated prototype: no form integration, storage, recovery, or passphrase policy.
 * The caller must obtain a user secret and stable opaque owner/scope identifiers.
 * Public identifiers are only authenticated context, never encryption secrets.
 * Secret/key lifetime and password UX require a separate product decision.
 */
export type BrowserDraftScope = { owner: string; kind: string; operationId: string };
export type BrowserDraftVaultEnvelope = {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  wrappedKey: string;
};
export type BrowserDraftEnvelope = { version: 1; algorithm: "AES-GCM"; iv: string; ciphertext: string };

const ITERATIONS = 600_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 1_000_000;
// Prototype resource bound, not a final product attachment/draft size policy.
const MAX_PLAINTEXT_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const fail = () => new Error("Browser draft cryptography failed.");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) throw fail();
}
function toBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function fromBase64(value: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > Math.ceil(max / 3) * 4
    || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) throw fail();
  const text = atob(value);
  if (text.length < min || text.length > max) throw fail();
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
  if (toBase64(bytes) !== value) throw fail();
  return bytes;
}
export function assertVaultEnvelope(envelope: unknown): asserts envelope is BrowserDraftVaultEnvelope {
  if (!record(envelope) || envelope.version !== 1 || envelope.algorithm !== "AES-GCM" || envelope.kdf !== "PBKDF2-SHA256"
    || !Number.isInteger(envelope.iterations) || (envelope.iterations as number) < MIN_ITERATIONS || (envelope.iterations as number) > MAX_ITERATIONS
    || Object.keys(envelope).sort().join(",") !== "algorithm,iterations,iv,kdf,salt,version,wrappedKey") throw fail();
  fromBase64(envelope.salt, 16, 16);
  fromBase64(envelope.iv, 12, 12);
  fromBase64(envelope.wrappedKey, 48, 48);
}
export function assertDraftEnvelope(envelope: unknown): asserts envelope is BrowserDraftEnvelope {
  if (!record(envelope) || envelope.version !== 1 || envelope.algorithm !== "AES-GCM"
    || Object.keys(envelope).sort().join(",") !== "algorithm,ciphertext,iv,version") throw fail();
  fromBase64(envelope.iv, 12, 12);
  fromBase64(envelope.ciphertext, 16, MAX_PLAINTEXT_BYTES + 16);
}
function vaultAad(envelope: Omit<BrowserDraftVaultEnvelope, "wrappedKey">, owner: string): Uint8Array<ArrayBuffer> {
  identifier(owner);
  return encoder.encode(JSON.stringify(["hub-om/browser-draft/vault", envelope.version, envelope.algorithm,
    envelope.kdf, envelope.iterations, envelope.salt, envelope.iv, owner]));
}
function draftAad(scope: BrowserDraftScope): Uint8Array<ArrayBuffer> {
  identifier(scope.owner); identifier(scope.kind); identifier(scope.operationId);
  return encoder.encode(JSON.stringify(["hub-om/browser-draft/value", 1, "AES-GCM", scope.owner, scope.kind, scope.operationId]));
}
async function wrappingKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  if (typeof secret !== "string") throw fail();
  const encoded = encoder.encode(secret);
  try {
    const material = await crypto.subtle.importKey("raw", encoded, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material,
      { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  } finally { encoded.fill(0); }
}
function dataKey(key: CryptoKey): void {
  if (key.type !== "secret" || key.extractable || key.algorithm.name !== "AES-GCM"
    || (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes("encrypt") || !key.usages.includes("decrypt")) throw fail();
}

export async function createVault(secret: string, owner: string): Promise<{ key: CryptoKey; envelope: BrowserDraftVaultEnvelope }> {
  try {
    identifier(owner);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const metadata = { version: 1, algorithm: "AES-GCM", kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
      salt: toBase64(salt), iv: toBase64(iv) } as const;
    const wrapper = await wrappingKey(secret, salt, ITERATIONS);
    // This temporary key is extractable only inside this function for wrapKey.
    // No raw key bytes enter application JS or persisted storage.
    const temporary = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const params = { name: "AES-GCM", iv, additionalData: vaultAad(metadata, owner), tagLength: 128 };
    const wrapped = await crypto.subtle.wrapKey("raw", temporary, wrapper, params);
    const key = await crypto.subtle.unwrapKey("raw", wrapped, wrapper, params, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { key, envelope: { ...metadata, wrappedKey: toBase64(wrapped) } };
  } catch { throw fail(); }
}

export async function unlockVault(envelope: unknown, secret: string, owner: string): Promise<CryptoKey> {
  try {
    assertVaultEnvelope(envelope);
    const metadata = envelope;
    const aad = vaultAad(metadata, owner);
    const wrapper = await wrappingKey(secret, fromBase64(metadata.salt, 16, 16), metadata.iterations);
    return await crypto.subtle.unwrapKey("raw", fromBase64(metadata.wrappedKey, 48, 48), wrapper,
      { name: "AES-GCM", iv: fromBase64(metadata.iv, 12, 12), additionalData: aad, tagLength: 128 },
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } catch { throw fail(); }
}

export async function encryptDraft(key: CryptoKey, scope: BrowserDraftScope, value: unknown): Promise<BrowserDraftEnvelope> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    dataKey(key);
    const aad = draftAad(scope);
    const text = JSON.stringify(value);
    if (text === undefined || text.length > MAX_PLAINTEXT_BYTES) throw fail();
    bytes = encoder.encode(text);
    if (bytes.length > MAX_PLAINTEXT_BYTES) throw fail();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, bytes);
    return { version: 1, algorithm: "AES-GCM", iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
  } catch { throw fail(); }
  finally { bytes?.fill(0); }
}

export async function decryptDraft<T = unknown>(key: CryptoKey, scope: BrowserDraftScope, envelope: unknown): Promise<T> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    dataKey(key);
    const aad = draftAad(scope);
    assertDraftEnvelope(envelope);
    const ciphertext = fromBase64(envelope.ciphertext, 16, MAX_PLAINTEXT_BYTES + 16);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv, 12, 12),
      additionalData: aad, tagLength: 128 }, key, ciphertext));
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch { throw fail(); }
  finally { bytes?.fill(0); }
}
