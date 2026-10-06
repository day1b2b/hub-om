import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLegacyUtf8Mojibake } from "@/lib/textEncoding";

test("UTF-8을 Latin-1로 잘못 읽은 파트명을 복구한다", () => {
  const mojibake = Buffer.from("1파트", "utf8").toString("latin1");
  assert.equal(normalizeLegacyUtf8Mojibake(mojibake), "1파트");
});

test("정상 Unicode와 UTF-8이 아닌 문자열은 바꾸지 않는다", () => {
  assert.equal(normalizeLegacyUtf8Mojibake("1파트"), "1파트");
  assert.equal(normalizeLegacyUtf8Mojibake("café"), "café");
});
