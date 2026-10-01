import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";

const savedSource = process.env.OPERATION_DATA_SOURCE, savedDatabase = process.env.DATABASE_URL;
process.env.OPERATION_DATA_SOURCE = "local"; delete process.env.DATABASE_URL;
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { email: "local-user@day1company.co.kr", name: "Local user" }, expires: "" }) } });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({ getOperationById: async () => null }) } });
let calendarRetries = 0;
mock.module("@/lib/googleCalendar/reflectOperationToCalendar", { namedExports: { reflectOperationCreated: async () => {}, reflectOperationDelete: async () => {}, reflectOperationUpdated: async () => {}, retryOperationCalendarDelete: async () => { calendarRetries++; return "completed"; } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const route = await import("./route"); hooks.deregister();

test("local operation backend keeps repeated or missing DELETE at 404 without Calendar persistence", async () => {
  try {
    const response = await route.DELETE(new Request("https://example.invalid/api/operations/missing", { method: "DELETE" }), { params: Promise.resolve({ operationId: "missing" }) });
    assert.equal(response.status, 404); assert.deepEqual(await response.json(), { ok: false, error: "Operation not found." }); assert.equal(calendarRetries, 0);
  } finally {
    if (savedSource === undefined) delete process.env.OPERATION_DATA_SOURCE; else process.env.OPERATION_DATA_SOURCE = savedSource;
    if (savedDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedDatabase;
  }
});
