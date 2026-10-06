import assert from "node:assert/strict";
import test from "node:test";
import { countLegacyDrafts, legacyDraftKeys, LEGACY_DRAFT_PREFIXES } from "./legacyDraftSources";

test("four legacy families are scanned by key only in both stores, never disclosing values", () => {
  const keys = [...LEGACY_DRAFT_PREFIXES.map(v => `${v}synthetic`), "unrelated"];
  const storage = { length: keys.length, key: (i: number) => keys[i], getItem: () => { throw new Error("must not read"); }, setItem: () => { throw new Error("must not write"); }, removeItem: () => { throw new Error("must not delete"); } };
  assert.equal(legacyDraftKeys(storage).length, 4);
  assert.deepEqual(countLegacyDrafts(() => storage), { localStorage: 4, sessionStorage: 4, unavailable: false });
});
test("inaccessible stores cannot produce a false all-clear", () => {
  assert.equal(countLegacyDrafts(() => { throw new Error("denied"); }).unavailable, true);
});
