import type { Document } from "mongodb";
import { encryptField, indexField, privacyFields, storedEncrypted } from "../privacy/fields";

export type MongoPrivacyViolation = Readonly<{ model: string; field: string }>;

type StoredPrivacyValue = Readonly<{
  value: unknown;
  jsonTag: "raw" | "json" | "json-null";
}>;

function storedPrivacyValue(type: string, value: unknown): StoredPrivacyValue {
  if (type !== "Json" || value === null || typeof value !== "object" || Array.isArray(value)) {
    return { value, jsonTag: "raw" };
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && Object.hasOwn(value, "$json")) {
    return { value: (value as Record<string, unknown>).$json, jsonTag: "json" };
  }
  if (keys.length === 1 && (value as Record<string, unknown>).$jsonNull === true) {
    return { value: null, jsonTag: "json-null" };
  }
  return { value, jsonTag: "raw" };
}

/**
 * Read-only cutover gate. It reports field names only and never returns values,
 * identifiers, ciphertext, or hashes from the inspected document.
 */
export function mongoPrivacyViolations(model: string, document: Document): MongoPrivacyViolation[] {
  const fields = privacyFields[model]?.fields ?? {};
  const violations: MongoPrivacyViolation[] = [];
  for (const [field, policy] of Object.entries(fields)) {
    const storedField = policy.storage ?? field;
    const stored = storedPrivacyValue(policy.type, document[storedField]);
    const value = stored.value;
    if (value == null) continue;
    // A small, explicit audit-metadata exception remains readable by contract
    // even after PII_ALLOW_PLAINTEXT_READS is disabled.
    if (policy.allowAuditMetadata && policy.type === "Json" && !storedEncrypted(policy, value)) continue;
    if (!storedEncrypted(policy, value)) violations.push(Object.freeze({ model, field: storedField }));
  }
  return violations;
}

/**
 * Builds a new document for an isolated namespace. The source object is never
 * mutated. Existing ciphertext remains byte-identical; only legacy plaintext
 * fields and their lookup companions are replaced.
 */
export function encryptLegacyMongoPrivacyFields(model: string, document: Document): Readonly<{
  document: Document;
  changedFields: readonly string[];
}> {
  const fields = privacyFields[model]?.fields ?? {};
  // Preserve BSON scalar prototypes (Decimal128, Binary, Date). We only replace
  // top-level privacy fields, so a shallow copy isolates every mutation needed here.
  const next = { ...document };
  const changedFields: string[] = [];
  for (const [field, policy] of Object.entries(fields)) {
    const storedField = policy.storage ?? field;
    const stored = storedPrivacyValue(policy.type, document[storedField]);
    const value = stored.value;
    if (value == null || storedEncrypted(policy, value)) continue;
    // This JSON is an explicit reviewed exception and must retain its validator shape.
    if (policy.allowAuditMetadata && policy.type === "Json") continue;
    const encrypted = encryptField(model, field, value);
    next[storedField] = stored.jsonTag === "json" ? { $json: encrypted } : encrypted;
    if (policy.index) next[policy.index] = indexField(model, field, value);
    changedFields.push(storedField);
  }
  return Object.freeze({ document: next, changedFields: Object.freeze(changedFields) });
}
