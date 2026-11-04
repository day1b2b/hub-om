import { test } from "node:test";
import assert from "node:assert/strict";
import { listModusignDocuments, odataString, readModusignConfig } from "./modusignClient";

test("readModusignConfig: 둘 다 있어야 켜진다", () => {
  assert.equal(readModusignConfig({ MODUSIGN_API_EMAIL: "a@x" } as unknown as NodeJS.ProcessEnv), null);
  assert.deepEqual(readModusignConfig({ MODUSIGN_API_EMAIL: " a@x ", MODUSIGN_API_KEY: " k " } as unknown as NodeJS.ProcessEnv), { email: "a@x", apiKey: "k" });
});

test("odataString: 작은따옴표 이스케이프", () => {
  assert.equal(odataString("O'Neil"), "'O''Neil'");
});

test("listModusignDocuments: Basic 인증 + 100개씩 끝까지", async () => {
  const calls: { url: string; authorization: string }[] = [];
  const pages = [Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })), [{ id: "b0" }]];
  const documents = await listModusignDocuments(
    { email: "a@x", apiKey: "key" },
    {
      filter: "status eq 'ON_GOING'",
      fetchImpl: async (url, init) => {
        calls.push({ url, authorization: init.headers.authorization });
        return { ok: true, status: 200, json: async () => ({ count: 101, documents: pages[calls.length - 1] }) };
      },
      sleep: async () => {}
    }
  );
  assert.equal(documents.length, 101);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, `Basic ${Buffer.from("a@x:key").toString("base64")}`);
  const second = new URL(calls[1].url);
  assert.equal(second.origin + second.pathname, "https://api.modusign.co.kr/documents");
  assert.equal(second.searchParams.get("offset"), "100");
  assert.equal(second.searchParams.get("filter"), "status eq 'ON_GOING'");
});

test("listModusignDocuments: 실패 응답이면 던진다(키 값은 메시지에 없다)", async () => {
  await assert.rejects(
    listModusignDocuments(
      { email: "a@x", apiKey: "secret-key" },
      { filter: "", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }), sleep: async () => {} }
    ),
    (error: Error) => error.message.includes("401") && !error.message.includes("secret-key")
  );
});
