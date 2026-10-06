import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/** Server only: never import this module from a browser entry point. */
export type BrowserDraftKeyring = {
  version: 1;
  ownerId: string;
  subject: string;
  activeKeyId: string;
  keys: Array<{ keyId: string; keyBase64: string }>;
};
export type BrowserDraftKeyringEnvironment = Record<string, string | undefined>;
const configurationFailure = () => new Error("Browser draft key configuration is unavailable.");
const KEY_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_KEYS = 8;

function randomKey(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw configurationFailure();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) throw configurationFailure();
  return bytes;
}
function sameKey(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
function otherKeyMaterial(env: BrowserDraftKeyringEnvironment): Buffer[] {
  const values = Object.entries(env)
    .filter(([name, value]) => !!value && (/^AUTH_SECRET(?:_\d+)?$/.test(name) || name === "NEXTAUTH_SECRET" || name === "PII_INDEX_KEY"))
    .map(([, value]) => value!);
  if (env.PII_ENCRYPTION_KEYS) {
    try {
      const pii: unknown = JSON.parse(env.PII_ENCRYPTION_KEYS);
      if (!pii || typeof pii !== "object" || Array.isArray(pii)) throw configurationFailure();
      for (const value of Object.values(pii)) {
        if (typeof value !== "string") throw configurationFailure();
        values.push(value);
      }
    } catch { throw configurationFailure(); }
  }
  // Catch literal, base64 and base64url reuse of configured authentication/PII material.
  return values.flatMap(value => [Buffer.from(value, "utf8"), Buffer.from(value, "base64")]);
}

export function deriveBrowserDraftKeyring(
  subject: string,
  env: BrowserDraftKeyringEnvironment = process.env,
): BrowserDraftKeyring {
  // Subject must come from the authenticated Google account, never email/body/query.
  if (typeof subject !== "string" || !subject.startsWith("google:") || subject.length <= 7 || subject.length > 262 || /\s|[\u0000-\u001f\u007f]/.test(subject)) {
    throw configurationFailure();
  }
  const active = env.BROWSER_DRAFT_ACTIVE_KEY_ID;
  if (!active || !KEY_ID.test(active)) throw configurationFailure();
  const raw = env.BROWSER_DRAFT_MASTER_KEYS;
  if (!raw || raw.length > 4096) throw configurationFailure();
  let configured: unknown;
  try { configured = JSON.parse(raw); } catch { throw configurationFailure(); }
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw configurationFailure();
  const entries = Object.entries(configured);
  if (!entries.length || entries.length > MAX_KEYS || !entries.some(([id]) => id === active)) throw configurationFailure();
  const ownerKey = randomKey(env.BROWSER_DRAFT_OWNER_KEY);
  const forbidden = otherKeyMaterial(env);
  const masters = entries.map(([keyId, value]) => {
    if (!KEY_ID.test(keyId)) throw configurationFailure();
    return { keyId, material: randomKey(value) };
  });
  const independent = [ownerKey, ...masters.map(entry => entry.material)];
  for (let i = 0; i < independent.length; i++) {
    if (forbidden.some(value => sameKey(value, independent[i])) || independent.slice(0, i).some(value => sameKey(value, independent[i]))) {
      throw configurationFailure();
    }
  }
  // Owner HMAC remains stable when encryption masters rotate. HKDF info uses
  // array encoding to separate domains/components. Root material never leaves server.
  const ownerId = "bdo1_" + createHmac("sha256", ownerKey)
    .update(JSON.stringify(["hub-om/browser-drafts/owner/v1", subject])).digest("base64url");
  const keys = masters.sort((a, b) => a.keyId.localeCompare(b.keyId)).map(({ keyId, material }) => ({
    keyId,
    keyBase64: Buffer.from(hkdfSync("sha256", material, "hub-om/browser-drafts/hkdf-salt/v1",
      JSON.stringify(["hub-om/browser-drafts/aes-256-gcm/v1", keyId, subject]), 32)).toString("base64"),
  }));
  return { version: 1, ownerId, subject, activeKeyId: active, keys };
}
