import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { assertPrivacyConfiguration, blindIndex, decrypt, encrypt } from "./crypto";

const key = randomBytes(32).toString("base64");
process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ test: key });
process.env.PII_ACTIVE_KEY_ID = "test";
process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
process.env.PII_ALLOW_PLAINTEXT_READS = "false";

test("randomized authenticated encryption, Unicode, empty values and purpose binding", () => {
  for (const plain of ["가상 사용자", "", "person@example.test", "pii:v1:user supplied text"]) {
    const one = encrypt(plain, "Coach.name"), two = encrypt(plain, "Coach.name");
    assert.notEqual(one, two);
    assert.equal(decrypt(one, "Coach.name"), plain);
    assert.throws(() => decrypt(one, "Coach.phone"));
    const parts = one.split(":"); parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
    assert.throws(() => decrypt(parts.join(":"), "Coach.name"));
  }
});
test("missing/invalid keys and plaintext reads fail closed", () => {
  assert.throws(() => decrypt("plain", "Coach.name"));
  const active = process.env.PII_ACTIVE_KEY_ID;
  process.env.PII_ACTIVE_KEY_ID = "missing";
  assert.throws(assertPrivacyConfiguration);
  process.env.PII_ACTIVE_KEY_ID = active;
});
test("key rotation reads old ciphertext and lookup hashes are independent and purpose-bound", () => {
  const old = encrypt("abc", "test");
  const index = blindIndex("abc", "test");
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ test: key, next: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "next";
  assert.equal(decrypt(old, "test"), "abc");
  assert.equal(blindIndex("abc", "test"), index);
  assert.notEqual(blindIndex("abc", "other"), index);
  assert.notEqual(blindIndex("ABC", "test"), index);
});
