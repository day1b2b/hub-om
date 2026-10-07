import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { encryptField } from "../privacy/fields";
import { encryptLegacyMongoPrivacyFields, mongoPrivacyViolations } from "./mongoPrivacyReadiness";

const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;

test("privacy readiness rejects legacy plaintext without exposing its value", () => {
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false",
  });
  try {
    const encrypted = { name: encryptField("Coach", "name", "Synthetic coach") };
    assert.deepEqual(mongoPrivacyViolations("Coach", encrypted), []);
    const privateMarker = "PRIVATE-PLAINTEXT-MARKER";
    const violations = mongoPrivacyViolations("Coach", { ...encrypted, name: privateMarker });
    assert.deepEqual(violations, [{ model: "Coach", field: "name" }]);
    assert.equal(JSON.stringify(violations).includes(privateMarker), false);
  } finally {
    for (const [name, value] of saved) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});

test("explicit audit metadata exception does not block plaintext-read shutdown", () => {
  assert.deepEqual(mongoPrivacyViolations("ActivityChange", { changes: { safeMetadata: true } }), []);
});

test("isolated conversion preserves explicit audit metadata exception", () => {
  const source = { changes: { safeMetadata: true } };
  const converted = encryptLegacyMongoPrivacyFields("ActivityChange", source);
  assert.deepEqual(converted.document, source);
  assert.deepEqual(converted.changedFields, []);
});

test("isolated conversion encrypts legacy values without mutating source or unrelated ciphertext", () => {
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "true",
  });
  try {
    const existing = encryptField("OperationSession", "omName", "Existing OM");
    const source = { _id: "fixture", omName: existing, validationErrors: [{ code: "legacy" }], untouched: "same" };
    const converted = encryptLegacyMongoPrivacyFields("OperationSession", source);
    assert.deepEqual(converted.changedFields, ["validationErrors"]);
    assert.equal(converted.document.omName, existing);
    assert.equal(converted.document.untouched, "same");
    assert.deepEqual(source.validationErrors, [{ code: "legacy" }]);
    assert.deepEqual(mongoPrivacyViolations("OperationSession", converted.document), []);
  } finally {
    for (const [name, value] of saved) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});
