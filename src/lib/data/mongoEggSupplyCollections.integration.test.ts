import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { createMissingEggSupplyCollections, EGG_SUPPLY_MODELS, inspectEggSupplyCollections } from "./mongoEggSupplyCollections";
import { MongoOperationError, MongoOperationStore } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";

const uri = process.env.MONGODB_EGG_SUPPLY_TEST_URI;

test("egg and supply collections: report, create only missing, never touch an existing one", { skip: !uri, timeout: 120_000 }, async () => {
  const databaseName = `hub_om_shadow_egg_supply_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_egg_supply_${randomBytes(6).toString("hex")}`;
  const client = new MongoClient(uri!);
  try {
    await client.connect();
    const options = { client, databaseName, namespace };

    // 처음에는 여섯 컬렉션 모두 없다.
    assert.deepEqual((await inspectEggSupplyCollections(options)).map((row) => row.state), EGG_SUPPLY_MODELS.map(() => "missing"));

    // 하나가 이미 준비돼 있으면 그것은 건너뛰고 나머지만 만든다.
    await prepareMongoReadStore({ ...options, allowShadowWrites: true }, ["EggDevice"]);
    const first = await createMissingEggSupplyCollections({ ...options, allowShadowWrites: true });
    assert.deepEqual(first, { created: EGG_SUPPLY_MODELS.filter((model) => model !== "EggDevice"), alreadyReady: ["EggDevice"] });
    assert.deepEqual((await inspectEggSupplyCollections(options)).map((row) => row.state), EGG_SUPPLY_MODELS.map(() => "ready"));

    // 다시 실행해도 아무것도 바꾸지 않는다.
    assert.deepEqual(await createMissingEggSupplyCollections({ ...options, allowShadowWrites: true }), { created: [], alreadyReady: [...EGG_SUPPLY_MODELS] });

    // 계약과 다른 컬렉션이 있으면 그대로 두고 멈춘다.
    const store = new MongoOperationStore(options, ["SupplyRentalItem"]);
    const name = store.collection("SupplyRentalItem").collectionName;
    await client.db(databaseName).command({ collMod: name, validator: {}, validationLevel: "strict", validationAction: "error" });
    assert.equal((await inspectEggSupplyCollections(options)).at(-1)?.state, "different");
    await assert.rejects(createMissingEggSupplyCollections({ ...options, allowShadowWrites: true }), (error: unknown) =>
      error instanceof MongoOperationError && /EXISTING_COLLECTION_NOT_READY/.test(error.message));
    const info = await client.db(databaseName).listCollections({ name }, { nameOnly: false }).next();
    // 비워 둔 validator를 되살리지 않는다(빈 validator는 버전에 따라 {} 또는 생략으로 보인다).
    assert.deepEqual(info?.options?.validator ?? {}, {});
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
  }
});
