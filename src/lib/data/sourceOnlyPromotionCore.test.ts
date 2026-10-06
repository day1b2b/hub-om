import assert from "node:assert/strict";
import test from "node:test";
import { SourceTeam } from "@prisma/client";
import type { ImportPromotionSource, ImportPromotionTransaction } from "./importPromotionContract";
import { promoteSourceOnlyRows } from "./importPromotionCore";

const source = (id: string, fields: Record<string, string>, validationErrors: string[] = [], fingerprint: string | null = id): ImportPromotionSource => ({
  id, mappedFields: fields, validationErrors, sourceFingerprint: fingerprint, sourceTeam: SourceTeam.TEAM_1
});
function fixture() {
  const calls = { company: 0, companyData: undefined as { name: string; normalizedName: string } | undefined, course: 0, courseData: undefined as { courseId: string; name: string } | undefined, create: 0, link: [] as string[] };
  const tx: ImportPromotionTransaction = {
    async getRun() { return null; }, async listUnlinkedSources() { return []; },
    async findByFingerprint(value) { return value === "existing" ? { id: "existing-operation", deletedAt: new Date() } : null; },
    async findByBusinessKey() { throw new Error("legacy command must not use business-key matching"); },
    async upsertCompany(data) { calls.company++; calls.companyData = data; return { id: "company" }; },
    async upsertCourse(data) { calls.course++; calls.courseData = { courseId: data.courseId, name: data.name }; return { id: "course" }; },
    async createOperation(data) { calls.create++; assert.deepEqual(data.validationErrors, ["코스ID 누락"]); assert.equal(data.omName, "Synthetic OM"); assert.equal((data as typeof data & { avgSatisfaction: string | null }).avgSatisfaction, "4.7"); return { id: `operation-${calls.create}` }; },
    async restoreOperation() { throw new Error("legacy command must not revive"); },
    async linkSource(id) { calls.link.push(id); }
  };
  return { calls, tx };
}
const valid = { companyName: "Synthetic Company", courseName: "Synthetic Course", startDate: "2099-01-01", endDate: "2099-01-02", om: "Synthetic OM", ld: "Synthetic LD", avgSatisfaction: "4.7" };
const roster = { om: { "1팀": ["Synthetic OM"] }, ld: { "1팀": ["Synthetic LD"] } };

test("source-only promotion projects then atomically applies all team rows across runs", async () => {
  const rows = [source("new", valid, ["코스ID 누락"]), source("linked", valid, [], "existing"), source("blocked", valid, ["Synthetic blocking error"])];
  const dry = fixture(); assert.deepEqual(await promoteSourceOnlyRows(dry.tx, rows, roster, false), { sourceRows: 3, promoted: 1, linkedExisting: 1, blocked: 1, blockedReasons: { "Synthetic blocking error": 1 } });
  assert.deepEqual(dry.calls, { company: 0, companyData: undefined, course: 0, courseData: undefined, create: 0, link: [] });
  const applied = fixture(); assert.deepEqual(await promoteSourceOnlyRows(applied.tx, rows, roster, true), { sourceRows: 3, promoted: 1, linkedExisting: 1, blocked: 1, blockedReasons: { "Synthetic blocking error": 1 } });
  assert.deepEqual(applied.calls, { company: 1, companyData: { name: "Synthetic Company", normalizedName: "synthetic company" }, course: 1, courseData: { courseId: "", name: "Synthetic Course" }, create: 1, link: ["new", "linked"] });
});

test("source-only dry-run predicts duplicate fingerprints across import runs", async () => {
  const dry = fixture();
  assert.deepEqual(await promoteSourceOnlyRows(dry.tx, [source("first", valid, [], "shared"), source("second", valid, [], "shared")], roster, false),
    { sourceRows: 2, promoted: 1, linkedExisting: 1, blocked: 0, blockedReasons: {} });
  assert.deepEqual(dry.calls, { company: 0, companyData: undefined, course: 0, courseData: undefined, create: 0, link: [] });
});

test("source-only promotion preserves the legacy single-space natural keys", async () => {
  const applied = fixture();
  await promoteSourceOnlyRows(applied.tx, [source("spaces", { ...valid, companyName: " Synthetic\n Company ", courseName: " Synthetic\t Course ", courseId: " COURSE\n 01 " }, ["코스ID 누락"])], roster, true);
  assert.deepEqual(applied.calls.companyData, { name: "Synthetic Company", normalizedName: "synthetic company" });
  assert.deepEqual(applied.calls.courseData, { courseId: "COURSE 01", name: "Synthetic Course" });
});
