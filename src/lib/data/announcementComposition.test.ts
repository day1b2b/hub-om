import assert from "node:assert/strict";
import test from "node:test";
import {
  runAnnouncementRequest,
  type AnnouncementCompositionDependencies
} from "./announcementComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const indexKey = Buffer.alloc(32, 2).toString("base64");
const environment = {
  ANNOUNCEMENT_BACKEND: "mongodb-shadow",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_announcements",
  MONGODB_SHADOW_NAMESPACE: "shadow_announcements",
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }),
  PII_ACTIVE_KEY_ID: "fixture",
  PII_INDEX_KEY: indexKey
};

function fixture(failure?: "connect" | "open" | "work" | "close") {
  const seen: string[] = [];
  const dependencies: AnnouncementCompositionDependencies = {
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
      return {
        async run<T>(work: () => Promise<T>) {
          seen.push("run");
          return work();
        }
      };
    }
  };
  const work = async () => {
    seen.push("work");
    if (failure === "work") throw new Error("private");
    return "ok";
  };
  return { seen, dependencies, work };
}

test("announcements default to PostgreSQL", async () => {
  const value = fixture();
  assert.equal(await runAnnouncementRequest(value.work, {}, value.dependencies), "ok");
  assert.deepEqual(value.seen, ["work"]);
});

test("exact Mongo selector owns one client and runtime", async () => {
  const value = fixture();
  assert.equal(await runAnnouncementRequest(value.work, environment, value.dependencies), "ok");
  assert.deepEqual(value.seen, ["client", "connect", "open", "run", "work", "close"]);
});

test("invalid selector and configuration fail before client", async () => {
  for (const invalid of [
    { ANNOUNCEMENT_BACKEND: "mongo" },
    { ANNOUNCEMENT_BACKEND: "mongodb-shadow" },
    { ...environment, PII_INDEX_KEY: key }
  ]) {
    const value = fixture();
    await assert.rejects(
      runAnnouncementRequest(value.work, invalid, value.dependencies),
      /^Error: ANNOUNCEMENT_COMPOSITION_FAILED$/
    );
    assert.deepEqual(value.seen, []);
  }
});

test("Mongo failures close the client and redact details", async () => {
  for (const failure of ["connect", "open", "work"] as const) {
    const value = fixture(failure);
    await assert.rejects(
      runAnnouncementRequest(value.work, environment, value.dependencies),
      /^Error: ANNOUNCEMENT_COMPOSITION_FAILED$/
    );
    assert.equal(value.seen.at(-1), "close");
  }
});

test("cleanup failure preserves a completed result", async () => {
  const value = fixture("close");
  assert.equal(await runAnnouncementRequest(value.work, environment, value.dependencies), "ok");
});

test("Next not-found control flow is preserved", async () => {
  const value = fixture();
  const notFound = Object.assign(new Error("not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  await assert.rejects(
    runAnnouncementRequest(async () => { throw notFound; }, environment, value.dependencies),
    error => error === notFound
  );
});
