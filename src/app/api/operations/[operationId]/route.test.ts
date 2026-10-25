import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";

const savedSource = process.env.OPERATION_DATA_SOURCE, savedDatabase = process.env.DATABASE_URL;
process.env.OPERATION_DATA_SOURCE = "local"; delete process.env.DATABASE_URL;
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { email: "local-user@day1company.co.kr", name: "Local user" }, expires: "" }) } });
type FakeRow = { operationId: string; roundNo: string; courseId: string; courseName: string; companyName: string; courseRecordId?: string };
let rows: FakeRow[] = []; const deleted: string[] = []; const updated: Array<{ id: string; roundNo: string }> = [];
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({
  getOperationById: async (id: string) => rows.find((row) => row.operationId === id) ?? null,
  listOperations: async () => rows,
  deleteOperation: async (id: string) => { deleted.push(id); rows = rows.filter((row) => row.operationId !== id); },
  updateOperation: async (id: string, input: { roundNo?: string }) => {
    updated.push({ id, roundNo: input.roundNo ?? "" });
    const row = rows.find((candidate) => candidate.operationId === id);
    if (row && input.roundNo) row.roundNo = input.roundNo;
    return row;
  }
}) } });
let calendarRetries = 0;
mock.module("@/lib/googleCalendar/reflectOperationToCalendar", { namedExports: { reflectOperationCreated: async () => {}, reflectOperationDelete: async () => {}, reflectOperationUpdated: async () => {}, retryOperationCalendarDelete: async () => { calendarRetries++; return "completed"; } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const route = await import("./route"); hooks.deregister();

test("local operation backend keeps repeated or missing DELETE at 404 without Calendar persistence", async () => {
  rows = [];
  try {
    const response = await route.DELETE(new Request("https://example.invalid/api/operations/missing", { method: "DELETE" }), { params: Promise.resolve({ operationId: "missing" }) });
    assert.equal(response.status, 404); assert.deepEqual(await response.json(), { ok: false, error: "Operation not found." }); assert.equal(calendarRetries, 0);
  } finally {
    if (savedSource === undefined) delete process.env.OPERATION_DATA_SOURCE; else process.env.OPERATION_DATA_SOURCE = savedSource;
    if (savedDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedDatabase;
  }
});

test("DELETE counts rounds by course record even when the course ID is empty", async () => {
  const base = { courseId: "", courseName: "과정A", companyName: "고객A" };
  rows = [
    { ...base, operationId: "r1", roundNo: "1", courseRecordId: "course-a" },
    { ...base, operationId: "r4", roundNo: "4", courseRecordId: "course-a" },
    { ...base, operationId: "other", roundNo: "4", courseRecordId: "course-b" }
  ];
  const del = (id: string) => route.DELETE(new Request(`https://example.invalid/api/operations/${id}`, { method: "DELETE" }), { params: Promise.resolve({ operationId: id }) });
  try {
    assert.equal((await del("r4")).status, 200); assert.deepEqual(deleted, ["r4"]);
    // 이름이 같아도 다른 과정(course-b)의 회차는 세지 않으므로 그 과정의 마지막 회차로 막힌다.
    const rejected = await del("other"); assert.equal(rejected.status, 400); assert.equal((await rejected.json()).code, "LAST_ROUND"); assert.deepEqual(deleted, ["r4"]);
  } finally { rows = []; deleted.length = 0; updated.length = 0; }
});

test("유일한 1회차는 삭제가 막힌다", async () => {
  const base = { courseId: "course", courseName: "Course", companyName: "Company" };
  rows = [
    { ...base, operationId: "solo-1", roundNo: "1", courseRecordId: "course-solo" },
    { ...base, operationId: "solo-2", roundNo: "2", courseRecordId: "course-solo" }
  ];
  try {
    const response = await route.DELETE(new Request("https://example.invalid/api/operations/solo-1", { method: "DELETE" }), { params: Promise.resolve({ operationId: "solo-1" }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "FIRST_ROUND",
      error: "1회차는 삭제할 수 없습니다. 이 회차를 없애야 하면 회차 순서를 끌어서 옮긴 뒤 지워주세요."
    });
    assert.deepEqual(deleted, []);
  } finally { rows = []; deleted.length = 0; updated.length = 0; }
});

test("중복 생성된 1회차는 다른 1회차가 남아있으면 삭제할 수 있다", async () => {
  const base = { courseId: "course", courseName: "Course", companyName: "Company" };
  rows = [
    { ...base, operationId: "dup-1", roundNo: "1", courseRecordId: "course-dup" },
    { ...base, operationId: "dup-2", roundNo: "1", courseRecordId: "course-dup" }
  ];
  try {
    const response = await route.DELETE(new Request("https://example.invalid/api/operations/dup-2", { method: "DELETE" }), { params: Promise.resolve({ operationId: "dup-2" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(deleted, ["dup-2"]);
  } finally { rows = []; deleted.length = 0; updated.length = 0; }
});

test("중간 회차를 삭제하면 남은 회차가 1부터 다시 채번된다", async () => {
  const base = { courseId: "course", courseName: "Course", companyName: "Company" };
  rows = [
    { ...base, operationId: "r1", roundNo: "1", courseRecordId: "course-renumber" },
    { ...base, operationId: "r2", roundNo: "2", courseRecordId: "course-renumber" },
    { ...base, operationId: "r3", roundNo: "3", courseRecordId: "course-renumber" },
    { ...base, operationId: "r4", roundNo: "4", courseRecordId: "course-renumber" }
  ];
  try {
    const response = await route.DELETE(new Request("https://example.invalid/api/operations/r2", { method: "DELETE" }), { params: Promise.resolve({ operationId: "r2" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(deleted, ["r2"]);
    const remaining = [...rows].sort((a, b) => Number(a.roundNo) - Number(b.roundNo));
    assert.deepEqual(
      remaining.map((row) => [row.operationId, row.roundNo]),
      [["r1", "1"], ["r3", "2"], ["r4", "3"]]
    );
  } finally { rows = []; deleted.length = 0; updated.length = 0; }
});

test("삭제 후 남은 회차가 이미 연속이면 다시 쓰지 않는다", async () => {
  const base = { courseId: "course", courseName: "Course", companyName: "Company" };
  rows = [
    { ...base, operationId: "r1", roundNo: "1", courseRecordId: "course-noop" },
    { ...base, operationId: "r2", roundNo: "2", courseRecordId: "course-noop" },
    { ...base, operationId: "r3", roundNo: "3", courseRecordId: "course-noop" }
  ];
  try {
    const response = await route.DELETE(new Request("https://example.invalid/api/operations/r3", { method: "DELETE" }), { params: Promise.resolve({ operationId: "r3" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(deleted, ["r3"]);
    assert.deepEqual(updated, []);
  } finally { rows = []; deleted.length = 0; updated.length = 0; }
});
