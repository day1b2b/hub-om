import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import nextTesting from "next/experimental/testing/server.js";
const { unstable_doesMiddlewareMatch } = nextTesting;
test("only exact quarantine endpoints bypass proxy body cloning; other draft routes remain matched", () => {
  const source = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  const matcher = JSON.parse(source.match(/matcher:\s*(\[[\s\S]*?\])/)![1]);
  for (const url of ["/api/browser-drafts/quarantine/seal", "/api/browser-drafts/quarantine/verify"]) assert.equal(unstable_doesMiddlewareMatch({ config: { matcher }, url }), false);
  for (const url of ["/api/browser-drafts/keyring", "/api/browser-drafts/quarantine/seal-extra", "/api/browser-drafts/quarantine/verify/extra"]) assert.equal(unstable_doesMiddlewareMatch({ config: { matcher }, url }), true);
});
