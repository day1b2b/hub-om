import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorDiagnostic } from "./safeErrorDiagnostic";

test("safe diagnostic keeps bounded failure classifications", () => {
  const error = Object.assign(new Error("OM_REQUEST_WRITE_COMPOSITION_FAILED"), { code: "ECONNREFUSED" });
  assert.deepEqual(safeErrorDiagnostic(error), {
    name: "Error",
    code: "ECONNREFUSED",
    messageCode: "OM_REQUEST_WRITE_COMPOSITION_FAILED",
  });
  assert.deepEqual(safeErrorDiagnostic(Object.assign(new TypeError("private"), { code: 112 })), {
    name: "TypeError",
    code: 112,
  });
});

test("safe diagnostic drops messages, stacks, unsafe codes, and non-errors", () => {
  const privateValue = "synthetic-private@example.invalid mongodb://secret";
  const result = safeErrorDiagnostic(Object.assign(new Error(privateValue), {
    code: privateValue,
    cause: new Error(privateValue),
  }));
  assert.deepEqual(result, { name: "Error" });
  assert.ok(!JSON.stringify(result).includes(privateValue));
  assert.deepEqual(safeErrorDiagnostic(privateValue), { name: "NonError" });
});
