import { timingSafeEqual } from "node:crypto";
import { configuredMongoUri, shadowDatabaseName } from "../mongodb/connection";

export type MongoCompositionEnvironment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;

function decodeCanonicalKey(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value ? decoded : null;
}

function assertPrivacyEnvironment(env: MongoCompositionEnvironment): void {
  const active = env.PII_ACTIVE_KEY_ID ?? "";
  let values: unknown;
  try { values = JSON.parse(env.PII_ENCRYPTION_KEYS ?? ""); }
  catch { throw new Error("privacy"); }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(active) || !values || typeof values !== "object" || Array.isArray(values)) throw new Error("privacy");
  const activeKey = decodeCanonicalKey((values as Record<string, unknown>)[active]);
  const indexKey = decodeCanonicalKey(env.PII_INDEX_KEY);
  if (!activeKey || !indexKey || timingSafeEqual(activeKey, indexKey)) throw new Error("privacy");
}

export function requireMongoShadowComposition(env: MongoCompositionEnvironment) {
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("configuration");
  assertPrivacyEnvironment(env);
  configuredMongoUri(env);
  return { databaseName: shadowDatabaseName(env), namespace };
}
