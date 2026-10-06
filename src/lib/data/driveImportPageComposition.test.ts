import assert from "node:assert/strict";
import test from "node:test";
import {
  runDriveImportPageRequest,
  type DriveImportPageCompositionDependencies
} from "./driveImportPageComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const indexKey = Buffer.alloc(32, 2).toString("base64");
const environment = {
  DRIVE_IMPORT_PAGE_BACKEND: "mongodb-shadow",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_drive_page",
  MONGODB_SHADOW_NAMESPACE: "shadow_drive_page",
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }),
  PII_ACTIVE_KEY_ID: "fixture",
  PII_INDEX_KEY: indexKey
};

function fixture(failure?: "connect" | "open" | "work" | "close") {
  const seen: string[] = [];
  const dependencies: DriveImportPageCompositionDependencies = {
    createClient() {
      seen.push("client");
      return {
        async connect() {
          seen.push("connect");
          if (failure === "connect") throw new Error("private connection detail");
        },
        async close() {
          seen.push("close");
          if (failure === "close") throw new Error("private cleanup detail");
        }
      };
    },
    async openRuntime() {
      seen.push("open");
      if (failure === "open") throw new Error("private runtime detail");
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
    if (failure === "work") throw new Error("private repository detail");
    return "ok";
  };
  return { dependencies, seen, work };
}

test("Drive import page defaults to PostgreSQL", async () => {
  const value = fixture();
  assert.equal(await runDriveImportPageRequest(value.work, {}, value.dependencies), "ok");
  assert.deepEqual(value.seen, ["work"]);
});

test("exact Mongo selector owns one request client", async () => {
  const value = fixture();
  assert.equal(await runDriveImportPageRequest(value.work, environment, value.dependencies), "ok");
  assert.deepEqual(value.seen, ["client", "connect", "open", "run", "work", "close"]);
});

test("invalid selectors and configuration fail before client creation", async () => {
  for (const invalid of [
    { DRIVE_IMPORT_PAGE_BACKEND: "mongo" },
    { DRIVE_IMPORT_PAGE_BACKEND: "mongodb-shadow" },
    { ...environment, PII_INDEX_KEY: key }
  ]) {
    const value = fixture();
    await assert.rejects(
      runDriveImportPageRequest(value.work, invalid, value.dependencies),
      /^Error: DRIVE_IMPORT_PAGE_COMPOSITION_FAILED$/
    );
    assert.deepEqual(value.seen, []);
  }
});

test("request failures close the client and redact private details", async () => {
  for (const failure of ["connect", "open", "work"] as const) {
    const value = fixture(failure);
    await assert.rejects(
      runDriveImportPageRequest(value.work, environment, value.dependencies),
      /^Error: DRIVE_IMPORT_PAGE_COMPOSITION_FAILED$/
    );
    assert.equal(value.seen.at(-1), "close");
  }
});

test("cleanup failure preserves a successful page result", async () => {
  const value = fixture("close");
  assert.equal(await runDriveImportPageRequest(value.work, environment, value.dependencies), "ok");
});

test("exact Next redirect control flow is preserved", async () => {
  const value = fixture();
  const redirect = Object.assign(new Error("redirect"), {
    digest: "NEXT_REDIRECT;replace;/sign-in;307;"
  });
  await assert.rejects(
    runDriveImportPageRequest(async () => { throw redirect; }, environment, value.dependencies),
    error => error === redirect
  );
});

test("arbitrary Next digest is redacted", async () => {
  const value = fixture();
  const privateError = Object.assign(new Error("private"), { digest: "NEXT_PRIVATE_DATABASE" });
  await assert.rejects(
    runDriveImportPageRequest(async () => { throw privateError; }, environment, value.dependencies),
    /^Error: DRIVE_IMPORT_PAGE_COMPOSITION_FAILED$/
  );
});
