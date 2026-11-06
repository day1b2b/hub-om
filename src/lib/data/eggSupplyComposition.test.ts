import assert from "node:assert/strict";
import test from "node:test";
import { runEggRequest, runSupplyRequest, type EggSupplyCompositionDependencies } from "./eggSupplyComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const indexKey = Buffer.alloc(32, 2).toString("base64");
// 에그·물품은 운영 화면의 일부라 새 selector 없이 OPERATION_PAGES_BACKEND로 백엔드를 고른다.
const environment = {
  OPERATION_PAGES_BACKEND: "mongodb-shadow",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_egg_supply",
  MONGODB_SHADOW_NAMESPACE: "shadow_egg_supply",
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }),
  PII_ACTIVE_KEY_ID: "fixture",
  PII_INDEX_KEY: indexKey
};
const runners = [
  { name: "egg", run: runEggRequest, failure: /EGG_COMPOSITION_FAILED/ },
  { name: "supply", run: runSupplyRequest, failure: /SUPPLY_COMPOSITION_FAILED/ }
];

function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: EggSupplyCompositionDependencies = {
    createClient() {
      seen.push("client");
      return {
        async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private"); },
        async close() { seen.push("close"); if (failure === "close") throw new Error("private"); }
      };
    },
    async openRuntime(input) {
      seen.push(`open:${input.databaseName}/${input.namespace}`);
      if (failure === "open") throw new Error("private");
      return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } };
    }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private"); return "ok"; };
  return { seen, dependencies, work };
}

for (const { name, run, failure } of runners) {
  test(`${name} requests default to PostgreSQL when the selector is empty or postgres`, async () => {
    for (const value of [{}, { OPERATION_PAGES_BACKEND: "" }, { OPERATION_PAGES_BACKEND: "postgres" }]) {
      const f = fixture();
      assert.equal(await run(f.work, value, f.dependencies), "ok");
      assert.deepEqual(f.seen, ["work"]);
    }
  });

  test(`${name} requests open one Mongo client for mongodb-shadow`, async () => {
    const f = fixture();
    assert.equal(await run(f.work, environment, f.dependencies), "ok");
    assert.deepEqual(f.seen, ["client", "connect", "open:hub_om_shadow_egg_supply/shadow_egg_supply", "run", "work", "close"]);
  });

  test(`${name} requests ignore unrelated selectors`, async () => {
    const f = fixture();
    assert.equal(await run(f.work, { ...environment, OPERATION_PAGES_BACKEND: "postgres", COACH_MANAGEMENT_BACKEND: "mongodb-shadow" }, f.dependencies), "ok");
    assert.deepEqual(f.seen, ["work"]);
  });

  test(`${name} requests fail before connecting on an invalid selector or configuration`, async () => {
    for (const value of [
      { OPERATION_PAGES_BACKEND: "mongo" },
      { OPERATION_PAGES_BACKEND: "mongodb-shadow" },
      { ...environment, PII_INDEX_KEY: key }
    ]) {
      const f = fixture();
      await assert.rejects(run(f.work, value, f.dependencies), failure);
      assert.deepEqual(f.seen, []);
    }
  });

  test(`${name} runtime failures close the client and hide the cause`, async () => {
    for (const reason of ["connect", "open", "work"]) {
      const f = fixture(reason);
      await assert.rejects(run(f.work, environment, f.dependencies), (error: unknown) => error instanceof Error && failure.test(error.message) && !error.message.includes("private"));
      assert.equal(f.seen.at(-1), "close");
    }
  });
}
