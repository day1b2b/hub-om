import assert from "node:assert/strict";
import test from "node:test";
import { runOmSessionTemplateRequest, type OmSessionTemplateCompositionDependencies } from "./omSessionTemplateComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const indexKey = Buffer.alloc(32, 2).toString("base64");
const environment = {
  OM_SESSION_TEMPLATE_BACKEND: "mongodb-shadow",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_om_session_template",
  MONGODB_SHADOW_NAMESPACE: "shadow_om_session_template",
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }),
  PII_ACTIVE_KEY_ID: "fixture",
  PII_INDEX_KEY: indexKey
};

function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: OmSessionTemplateCompositionDependencies = {
    createClient() {
      seen.push("client");
      return {
        async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private"); },
        async close() { seen.push("close"); if (failure === "close") throw new Error("private"); }
      };
    },
    async openRuntime() {
      seen.push("open");
      if (failure === "open") throw new Error("private");
      return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } };
    }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private"); return "ok"; };
  return { seen, dependencies, work };
}

test("OM session template defaults to PostgreSQL", async () => {
  const f = fixture();
  assert.equal(await runOmSessionTemplateRequest(f.work, {}, f.dependencies), "ok");
  assert.deepEqual(f.seen, ["work"]);
});

test("exact Mongo selector owns one request-audit runtime", async () => {
  const f = fixture();
  assert.equal(await runOmSessionTemplateRequest(f.work, environment, f.dependencies), "ok");
  assert.deepEqual(f.seen, ["client", "connect", "open", "run", "work", "close"]);
});

test("invalid selector and configuration fail before client", async () => {
  for (const value of [
    { OM_SESSION_TEMPLATE_BACKEND: "mongo" },
    { OM_SESSION_TEMPLATE_BACKEND: "mongodb-shadow" },
    { ...environment, PII_INDEX_KEY: key }
  ]) {
    const f = fixture();
    await assert.rejects(runOmSessionTemplateRequest(f.work, value, f.dependencies), /OM_SESSION_TEMPLATE_COMPOSITION_FAILED/);
    assert.deepEqual(f.seen, []);
  }
});

test("runtime failures close and redact", async () => {
  for (const failure of ["connect", "open", "work"]) {
    const f = fixture(failure);
    await assert.rejects(runOmSessionTemplateRequest(f.work, environment, f.dependencies), /OM_SESSION_TEMPLATE_COMPOSITION_FAILED/);
    assert.equal(f.seen.at(-1), "close");
  }
});

test("cleanup failure preserves completed response", async () => {
  const f = fixture("close");
  assert.equal(await runOmSessionTemplateRequest(f.work, environment, f.dependencies), "ok");
});

test("Next control flow is preserved", async () => {
  for (const digest of ["NEXT_REDIRECT;replace;/sign-in;307;", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
    const control = Object.assign(new Error("control"), { digest });
    const f = fixture();
    await assert.rejects(runOmSessionTemplateRequest(async () => { throw control; }, environment, f.dependencies), error => error === control);
  }
});
