import assert from "node:assert/strict";
import test from "node:test";
import { operationMongoValidator } from "./mongoOperationStore";
import { MongoOperationError, mongoFailureCode } from "./mongoOperationPrimitives";
import { compareOperationValidator, parseEnumWidening, widenedOperationValidator } from "./mongoValidatorWidening";

const clone = <T>(value: T): T => structuredClone(value);
type Properties = Record<string, { enum?: unknown[]; bsonType?: unknown }>;
type Validator = { $jsonSchema?: { properties: Properties }; $and?: [{ $jsonSchema: { properties: Properties } }, ...unknown[]] };
/** Models with private blind indexes wrap the shape in $and; OperationSession is one of them. */
const propertiesOf = (validator: unknown): Properties => {
  const shape = validator as Validator;
  return (shape.$jsonSchema ?? shape.$and![0].$jsonSchema).properties;
};
const ENUM_PATH = "/$and/0/$jsonSchema/properties/educationFormat/enum";
/** The deployed education format list with one new value inserted mid-list, the way #739 added ONLINE. */
const DEPLOYED = propertiesOf(operationMongoValidator("OperationSession")).educationFormat.enum as string[];
const NEXT = [...DEPLOYED.slice(0, 2), "WIDENING_FIXTURE", ...DEPLOYED.slice(2)];
const WIDEN = { model: "OperationSession", field: "educationFormat", values: NEXT };

test("identical validators compare as same", () => {
  const deployed = operationMongoValidator("OperationSession");
  assert.deepEqual(compareOperationValidator(clone(deployed), deployed), { kind: "same" });
});

test("a planned widening adds exactly the new value, in the next contract's order", () => {
  const deployed = operationMongoValidator("OperationSession");
  const target = widenedOperationValidator(WIDEN);
  assert.deepEqual(propertiesOf(target).educationFormat.enum, NEXT);
  assert.deepEqual(compareOperationValidator(deployed, target), { kind: "widening", added: [{ path: ENUM_PATH, values: ["WIDENING_FIXTURE"] }] });
  // Nothing but the enum list moves.
  const restored = clone(target);
  propertiesOf(restored).educationFormat.enum = propertiesOf(deployed).educationFormat.enum;
  assert.deepEqual(compareOperationValidator(deployed, restored), { kind: "same" });
});

test("a widening must keep every deployed value, add one, and name a known enum field", () => {
  for (const values of [NEXT.filter(item => item !== DEPLOYED[0]), DEPLOYED, [...NEXT, "WIDENING_FIXTURE"]]) {
    assert.throws(() => widenedOperationValidator({ ...WIDEN, values }), (error: unknown) => mongoFailureCode(error) === "ENUM_VALUES_NOT_WIDENING");
  }
  assert.throws(() => widenedOperationValidator({ ...WIDEN, field: "operationId" }), (error: unknown) => mongoFailureCode(error) === "ENUM_FIELD_REQUIRED");
  assert.throws(() => widenedOperationValidator({ ...WIDEN, model: "CoachProfile" }), (error: unknown) => mongoFailureCode(error) === "UNKNOWN_OPERATION_MODEL");
  // A contract model outside the operation and coach evaluation stores stays out of reach.
  assert.throws(() => widenedOperationValidator({ model: "Coach", field: "status", values: ["A"] }), (error: unknown) => mongoFailureCode(error) === "UNKNOWN_OPERATION_MODEL");
});

test("coach evaluation collections widen the same way (role enum)", () => {
  // The coach evaluation store also requires an exact validator match, so its enums need this path too.
  const deployed = operationMongoValidator("CoachEngagementDetail");
  const roles = propertiesOf(deployed).role.enum as string[];
  const next = [...roles, "WIDENING_FIXTURE"];
  const target = widenedOperationValidator({ model: "CoachEngagementDetail", field: "role", values: next });
  assert.deepEqual(propertiesOf(target).role.enum, next);
  const comparison = compareOperationValidator(deployed, target);
  assert.equal(comparison.kind, "widening");
  assert.deepEqual(comparison.kind === "widening" && comparison.added.map(item => item.values), [["WIDENING_FIXTURE"]]);
});

test("parseEnumWidening reads Model.field=V1,V2 and rejects anything else", () => {
  assert.deepEqual(parseEnumWidening(`OperationSession.educationFormat=${NEXT.join(",")}`), WIDEN);
  for (const bad of ["OperationSession.educationFormat=", "OperationSession=ONLINE", "OperationSession.educationFormat=online", "a.b=X;Y"]) {
    assert.throws(() => parseEnumWidening(bad), (error: unknown) => mongoFailureCode(error) === "INVALID_ENUM_WIDENING");
  }
});

test("enum order alone is a widening with nothing added, a removed enum value is incompatible", () => {
  const deployed = operationMongoValidator("OperationSession");
  const reordered = clone(deployed);
  propertiesOf(reordered).educationFormat.enum!.reverse();
  assert.deepEqual(compareOperationValidator(reordered, deployed), { kind: "widening", added: [] });

  const wider = clone(deployed);
  propertiesOf(wider).educationFormat.enum!.push("RETIRED");
  assert.deepEqual(compareOperationValidator(wider, deployed), { kind: "incompatible", path: ENUM_PATH });
});

test("any non-enum difference is incompatible", () => {
  const deployed = operationMongoValidator("OperationSession");
  const retyped = clone(deployed);
  propertiesOf(retyped).educationFormat.bsonType = "int";
  assert.equal(compareOperationValidator(retyped, deployed).kind, "incompatible");

  const extraField = clone(deployed);
  propertiesOf(extraField).legacy = { bsonType: "string" };
  assert.equal(compareOperationValidator(extraField, deployed).kind, "incompatible");

  assert.equal(compareOperationValidator({}, deployed).kind, "incompatible");
});

test("mongoFailureCode exposes the fixed code of a MongoOperationError and redacts free text", () => {
  assert.equal(mongoFailureCode(new MongoOperationError("VALIDATOR_NOT_READY")), "VALIDATOR_NOT_READY");
  assert.equal(mongoFailureCode(new Error("MONGO_OPERATION_PAGES_RUNTIME_FAILED")), "MONGO_OPERATION_PAGES_RUNTIME_FAILED");
  assert.equal(mongoFailureCode(new Error("connect ECONNREFUSED 10.0.0.1:27017")), "REDACTED");
  assert.equal(mongoFailureCode("not an error"), "REDACTED");
});
