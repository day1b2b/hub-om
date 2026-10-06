import assert from "node:assert/strict";
import test from "node:test";
import type { OperationImportEntry, OperationImportPort } from "./operationImportRepository";
import { importOperationRows } from "./operationImportCore";

const row = (operationId: string, courseName = "Synthetic Course"): OperationImportEntry => ({ operationId, companyName: "Synthetic Company", courseName, courseId: "COURSE-1", startDate: "2099-01-01", endDate: "2099-01-02", om: "Synthetic OM", ld: "Synthetic LD", specialNotes: "Synthetic private" });
function fixture() {
  const calls: string[] = [], operations = new Map<string, string>(), business = new Map<string, string>(), sources = new Set<string>(); let sequence = 0;
  const port: OperationImportPort = {
    async createImportRun() { calls.push("run:create"); return { id: "run" }; }, async finishImportRun() { calls.push("run:finish"); },
    async findOperationById(id) { return operations.has(id) ? { id: operations.get(id)! } : null; },
    async findOperationByBusinessKey(input) { const id = business.get(JSON.stringify([input.companyName.toLowerCase(), input.courseName, input.startDate.toISOString(), input.endDate.toISOString()])); return id ? { id } : null; },
    async upsertCompany() { calls.push("company"); return { id: "company" }; }, async upsertCourse() { calls.push("course"); return { id: "course" }; },
    async createOperation(input) { const id = `session-${++sequence}`; operations.set(input.operationId, id); business.set(JSON.stringify(["synthetic company", row("x").courseName, "2099-01-01T00:00:00.000Z", "2099-01-02T00:00:00.000Z"]), id); calls.push("operation:create"); return { id }; },
    async updateOperation() { calls.push("operation:update"); }, async sourceRecordExists(id, fp) { return sources.has(`${id}:${fp}`); },
    async createSourceRecord(input) { sources.add(`${input.operationSessionId}:${input.sourceFingerprint}`); calls.push("source:create"); }
  };
  return { calls, port };
}
const roster = { om: { "1팀": ["Synthetic OM"] }, ld: { "1팀": ["Synthetic LD"] } };

test("operation import transaction predicts same-batch business-key reuse", async () => {
  const f = fixture(), result = await importOperationRows({ port: f.port, roster }, [row("OP-1"), row("OP-2")], "synthetic.json");
  assert.deepEqual(result, { operations: 2, inserted: 1, updated: 1, sourceRecordsInserted: 2, sourceRecordsSkipped: 0 });
});

test("operation import apply creates run, updates repeated business key and is repeatable", async () => {
  const f = fixture(); const first = await importOperationRows({ port: f.port, roster }, [row("OP-1"), row("OP-2")], "synthetic.json");
  assert.deepEqual(first, { operations: 2, inserted: 1, updated: 1, sourceRecordsInserted: 2, sourceRecordsSkipped: 0 });
  assert.deepEqual(await importOperationRows({ port: f.port, roster }, [row("OP-1"), row("OP-2")], "synthetic.json"), { operations: 2, inserted: 0, updated: 2, sourceRecordsInserted: 0, sourceRecordsSkipped: 2 });
  assert.equal(f.calls.filter(value => value === "run:finish").length, 2);
});

test("operation import removes a stale business-key projection when the same operation moves", async () => {
  const operations = new Map<string, { id: string; operationId: string; businessKey: string }>(), sources = new Set<string>(); let courseName = "", sequence = 0;
  const businessKey = (name: string) => JSON.stringify(["synthetic company", name, "2099-01-01T00:00:00.000Z", "2099-01-02T00:00:00.000Z"]);
  const port: OperationImportPort = {
    async createImportRun() { return { id: "run" }; }, async finishImportRun() {}, async findOperationById(id) { const value = operations.get(id); return value ? { id: value.id } : null; },
    async findOperationByBusinessKey(input) { const value = [...operations.values()].find(item => item.businessKey === businessKey(input.courseName)); return value ? { id: value.id } : null; },
    async upsertCompany() { return { id: "company" }; }, async upsertCourse(input) { courseName = input.name; return { id: input.name }; },
    async createOperation(input) { const value = { id: `session-${++sequence}`, operationId: input.operationId, businessKey: businessKey(courseName) }; operations.set(input.operationId, value); return { id: value.id }; },
    async updateOperation(id) { const value = [...operations.values()].find(item => item.id === id)!; value.businessKey = businessKey(courseName); },
    async sourceRecordExists(id, fingerprint) { return sources.has(`${id}:${fingerprint}`); }, async createSourceRecord(input) { sources.add(`${input.operationSessionId}:${input.sourceFingerprint}`); }
  };
  const result = await importOperationRows({ port, roster }, [row("A", "Old"), row("A", "New"), row("B", "Old")], "synthetic.json");
  assert.deepEqual(result, { operations: 3, inserted: 2, updated: 1, sourceRecordsInserted: 2, sourceRecordsSkipped: 1 });
  assert.equal(operations.size, 2); assert.equal(operations.get("A")?.businessKey, businessKey("New")); assert.equal(operations.get("B")?.businessKey, businessKey("Old"));
});
