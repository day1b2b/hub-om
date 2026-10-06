import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLegacyUtf8Mojibake } from "@/lib/textEncoding";

test("UTF-8을 Latin-1로 잘못 읽은 파트명을 복구한다", () => {
  const mojibake = Buffer.from("1파트", "utf8").toString("latin1");
  assert.equal(normalizeLegacyUtf8Mojibake(mojibake), "1파트");
});

test("UTF-8을 Latin-1로 두 번 잘못 읽은 파트명도 복구한다", () => {
  const once = Buffer.from("1파트", "utf8").toString("latin1");
  const twice = Buffer.from(once, "utf8").toString("latin1");
  assert.equal(normalizeLegacyUtf8Mojibake(twice), "1파트");
});

test("정상 Unicode와 UTF-8이 아닌 문자열은 바꾸지 않는다", () => {
  assert.equal(normalizeLegacyUtf8Mojibake("1파트"), "1파트");
  assert.equal(normalizeLegacyUtf8Mojibake("café"), "café");
});
