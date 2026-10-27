import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import {
  COACH_EVALUATION_MODELS,
  createMissingCoachEvaluationCollections,
  inspectCoachEvaluationCollections
} from "./mongoCoachEvaluationCollections";
import { MongoOperationError, MongoOperationStore } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";

const uri = process.env.MONGODB_COACH_EVALUATION_COLLECTIONS_TEST_URI;

test("coach evaluation collections: report, create only missing, never touch an existing one", { skip: !uri, timeout: 120_000 }, async () => {
  const databaseName = `hub_om_shadow_coach_evaluation_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_coach_evaluation_${randomBytes(6).toString("hex")}`;
  const client = new MongoClient(uri!);
  try {
    await client.connect();
    const options = { client, databaseName, namespace };

    // 처음에는 세 컬렉션 모두 없다.
    assert.deepEqual((await inspectCoachEvaluationCollections(options)).map((row) => row.state), ["missing", "missing", "missing"]);

    // 하나가 이미 준비돼 있으면 그것은 건너뛰고 나머지만 만든다.
    await prepareMongoReadStore({ ...options, allowShadowWrites: true }, ["CoachEvaluation"]);
    const first = await createMissingCoachEvaluationCollections({ ...options, allowShadowWrites: true });
    assert.deepEqual(first, { created: ["CoachEngagementDetail", "CoachFactRecord"], alreadyReady: ["CoachEvaluation"] });
    assert.deepEqual((await inspectCoachEvaluationCollections(options)).map((row) => row.state), ["ready", "ready", "ready"]);

    // 다시 실행해도 아무것도 바꾸지 않는다.
    assert.deepEqual(await createMissingCoachEvaluationCollections({ ...options, allowShadowWrites: true }), { created: [], alreadyReady: [...COACH_EVALUATION_MODELS] });

    // 계약과 다른 컬렉션이 있으면 그대로 두고 멈춘다.
    const store = new MongoOperationStore(options, ["CoachFactRecord"]);
    const name = store.collection("CoachFactRecord").collectionName;
    await client.db(databaseName).command({ collMod: name, validator: {}, validationLevel: "strict", validationAction: "error" });
    assert.equal((await inspectCoachEvaluationCollections(options))[2].state, "different");
    await assert.rejects(createMissingCoachEvaluationCollections({ ...options, allowShadowWrites: true }), (error: unknown) =>
      error instanceof MongoOperationError && /EXISTING_COLLECTION_NOT_READY/.test(error.message));
    const info = await client.db(databaseName).listCollections({ name }, { nameOnly: false }).next();
    assert.deepEqual(info?.options?.validator, {});
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
  }
});
