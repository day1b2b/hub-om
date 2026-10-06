import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient } from "mongodb";
import { MongoOperationStore, OPERATION_MODELS, operationMongoIndexes, operationMongoValidator } from "./mongoOperationStore";
import { assertMongoReadStoreReady, COACH_READ_MODELS, TEAM_READ_MODELS } from "./mongoReadStore";
import { mongoRuntimeContracts } from "./mongoRuntimeCodec";

const options = { client: new MongoClient("mongodb://127.0.0.1:1"), databaseName: "hub-om-shadow-validation", namespace: "shadow_synthetic" };
test("read domains are explicit; original operation model set stays isolated", () => {
  const original = new MongoOperationStore(options);
  assert.deepEqual(original.models, OPERATION_MODELS);
  assert.throws(() => original.collection("Member"), /UNKNOWN_OPERATION_MODEL/);
  const roster = new MongoOperationStore(options, TEAM_READ_MODELS);
  assert.ok(roster.collection("Member"));
  assert.throws(() => roster.collection("Coach"), /UNKNOWN_OPERATION_MODEL/);
  for (const models of [[], ["Coach", "Coach"], ["__counter"], ["toString"]]) {
    assert.throws(() => new MongoOperationStore(options, models), /INVALID_MODEL_SET/);
  }
  assert.throws(() => new MongoOperationStore({...options, databaseName: "hub-om"}, TEAM_READ_MODELS), /SHADOW_DATABASE_REQUIRED/);
});
test("read validators allow exactly the codec field set including derived composite IDs", () => {
  for (const model of [...COACH_READ_MODELS, ...TEAM_READ_MODELS]) {
    const validator = operationMongoValidator(model);
    const shape = validator.$jsonSchema ?? validator.$and[0].$jsonSchema;
    const fields = Object.keys(mongoRuntimeContracts[model].fields).map(field => field === "id" ? "_id" : field);
    if (!fields.includes("_id")) fields.push("_id");
    assert.deepEqual([...shape.required].sort(), fields.sort(), model);
    assert.equal(shape.additionalProperties, false);
    assert.equal(shape.properties._id.bsonType, "string");
  }
});
test("read readiness uses only selected collections and rejects missing validators/indexes", async () => {
  const visited: string[] = [];
  const store = new MongoOperationStore(options, TEAM_READ_MODELS);
  let missing = "";
  const fake = {
    models: store.models,
    db: { listCollections({name}: {name:string}) {
      visited.push(name);
      const model = name.replace(options.namespace + "_", "");
      return { async next() { return missing === "validator" ? null : {options: {validator: operationMongoValidator(model), validationLevel: "strict", validationAction: "error"}}; } };
    } },
    collection(model:string) { return {collectionName: `${options.namespace}_${model}`, listIndexes() { return {async toArray() {return missing === "index" ? [] : operationMongoIndexes(model);}}; } }; }
  } as unknown as MongoOperationStore;
  await assertMongoReadStoreReady(fake);
  assert.deepEqual(visited, TEAM_READ_MODELS.map(model => `${options.namespace}_${model}`));
  missing = "validator";
  await assert.rejects(assertMongoReadStoreReady(fake), /VALIDATOR_NOT_READY/);
  missing = "index";
  await assert.rejects(assertMongoReadStoreReady(fake), /INDEX_NOT_READY/);
});
