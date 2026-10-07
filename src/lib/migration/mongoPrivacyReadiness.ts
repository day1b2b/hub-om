import type { Document } from "mongodb";
import { privacyFields, storedEncrypted } from "../privacy/fields";

export type MongoPrivacyViolation = Readonly<{ model: string; field: string }>;

/**
 * Read-only cutover gate. It reports field names only and never returns values,
 * identifiers, ciphertext, or hashes from the inspected document.
 */
export function mongoPrivacyViolations(model: string, document: Document): MongoPrivacyViolation[] {
  const fields = privacyFields[model]?.fields ?? {};
  const violations: MongoPrivacyViolation[] = [];
  for (const [field, policy] of Object.entries(fields)) {
    const storedField = policy.storage ?? field;
    const value = document[storedField];
    if (value == null) continue;
    // A small, explicit audit-metadata exception remains readable by contract
    // even after PII_ALLOW_PLAINTEXT_READS is disabled.
    if (policy.allowAuditMetadata && policy.type === "Json" && !storedEncrypted(policy, value)) continue;
    if (!storedEncrypted(policy, value)) violations.push(Object.freeze({ model, field: storedField }));
  }
  return violations;
}
