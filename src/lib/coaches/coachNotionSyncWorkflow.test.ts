/** Synthetic in-memory tests; no Notion or database access. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { findNotionCoach, runNotionCoachSync } from "./coachNotionSyncWorkflow";
import { mapPageToCoachRecord, type JsonObject } from "./notionCoachMap";
import { normalizeCoachName } from "./accessToken";
import type { CoachNotionSyncRepository, NotionSyncCoach } from "../data/coachNotionSyncRepository";
const text = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
function page(name = "Synthetic coach", notionNo: number | null = 100, props: JsonObject = {}): JsonObject {
  return { id: "synthetic-page", properties: { 이름: { type: "title", title: [{ plain_text: name }] }, ID: { type: "unique_id", unique_id: { number: notionNo } }, ...props } };
}
function coach(patch: Partial<NotionSyncCoach> = {}): NotionSyncCoach {
  return { id: randomUUID(), name: "Synthetic coach", normalizedName: normalizeCoachName("Synthetic coach"), createdAt: new Date("2000-01-01"), employeeNo: null, notionNo: null, notionPageId: null, workType: null, portfolioUrl: null, selfNote: null, availabilityDetail: null, privateProfile: null, fields: [], curriculums: [], ...patch };
}
function state(initial: NotionSyncCoach[] = []) {
  let rows = structuredClone(initial), failName = "", retries = false;
  const events: string[] = [];
  let beforeLock: (() => void) | undefined;
  const read = {
    async findByNotionNo(no: number) { return structuredClone(rows.find(row => row.notionNo === no) ?? null); },
    async listByNormalizedName(name: string) { return structuredClone(rows.filter(row => row.normalizedName === name).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())); }
  };
  const repository: CoachNotionSyncRepository = { ...read, async transaction(work) {
    events.push("catalog"); const snapshot = structuredClone(rows); let locked = "";
    const write = (id: string) => assert.equal(id, locked);
    const tx = { ...read,
      async lockCoaches(ids: string[]) { assert.equal(ids.length, 1); locked = ids[0]; beforeLock?.(); beforeLock = undefined; events.push("coach"); },
      async createCoach(input: Parameters<import("../data/coachNotionSyncRepository").CoachNotionSyncTransaction["createCoach"]>[0]) { write(input.id); rows.push(coach(input)); },
      async patchCoach(id: string, patch: Partial<NotionSyncCoach>) { write(id); Object.assign(rows.find(row => row.id === id)!, patch); },
      async upsertPrivateProfile(id: string, create: NonNullable<NotionSyncCoach["privateProfile"]>, patch: Partial<NonNullable<NotionSyncCoach["privateProfile"]>>) { write(id); const row = rows.find(row => row.id === id)!; if (row.name === failName) throw new Error("secret source token and PII"); row.privateProfile = row.privateProfile ? { ...row.privateProfile, ...patch } : create; },
      async replaceTags(id: string, kind: "fields" | "curriculums", names: string[]) { write(id); rows.find(row => row.id === id)![kind] = names; }
    };
    try {
      if (retries) { await work(tx); rows = structuredClone(snapshot); }
      const result = await work(tx); events.push("commit"); return result;
    } catch (error) { rows = snapshot; events.push("rollback"); throw error; }
  } };
  return { repository, events, get rows() { return rows; }, fail(name: string) { failName = name; }, retry() { retries = true; }, beforeLock(work: () => void) { beforeLock = work; } };
}

test("matching prioritizes notion ID, then oldest unkeyed name; null ID may match keyed names", async () => {
  const oldest = coach({ notionNo: 1 }), unkeyed = coach({ createdAt: new Date("2001-01-01") }), newer = coach({ createdAt: new Date("2002-01-01") });
  const fixture = state([newer, unkeyed, oldest]);
  assert.equal((await findNotionCoach(fixture.repository, mapPageToCoachRecord(page("Renamed", 1))!)).coach?.id, oldest.id);
  assert.equal((await findNotionCoach(fixture.repository, mapPageToCoachRecord(page())!)).coach?.id, unkeyed.id);
  assert.equal((await findNotionCoach(fixture.repository, mapPageToCoachRecord(page("Synthetic coach", null))!)).coach?.id, oldest.id);
});

test("duplicate identity uses phone OR exact birth date and the oldest matching coach", async () => {
  const profile = { employeeId: "old", phone: "same-phone", email: null, birthDate: new Date("1990-01-01"), affiliation: null };
  const first = coach({ notionNo: 1, privateProfile: profile }), second = coach({ notionNo: 2, createdAt: new Date("2001-01-01"), privateProfile: profile });
  const fixture = state([second, first]);
  const record = mapPageToCoachRecord(page("Synthetic coach", 100, { 연락처: text("different"), 생년월일: text("1990-01-01") }))!;
  const match = await findNotionCoach(fixture.repository, record); assert.equal(match.by, "duplicateRow"); assert.equal(match.coach?.id, first.id);
  record.birthDate = null; record.phone = "same-phone"; assert.equal((await findNotionCoach(fixture.repository, record)).coach?.id, first.id);
  record.phone = "unmatched"; const missing = await findNotionCoach(fixture.repository, record); assert.equal(missing.coach, null); assert.equal(missing.sameNameExists, true);
});

test("normal updates preserve site name and employeeId, overwrite populated incoming values and keep empty tags", async () => {
  const original = coach({ notionNo: 100, employeeNo: "old-public", fields: ["manual-tag"], privateProfile: { employeeId: "manual-id", phone: "old", email: "old@example.invalid", birthDate: null, affiliation: "manual" } });
  const fixture = state([original]);
  const result = await runNotionCoachSync([page("Changed name", 100, { 사번: { type: "number", number: 456 }, 연락처: text("new"), 이메일: text("new@example.invalid") })], fixture.repository, false);
  assert.equal(result.updated, 1); assert.equal(fixture.rows[0].name, original.name); assert.equal(fixture.rows[0].employeeNo, "456");
  assert.deepEqual(fixture.rows[0].privateProfile, { employeeId: "manual-id", phone: "new", email: "new@example.invalid", birthDate: null, affiliation: "manual" });
  assert.deepEqual(fixture.rows[0].fields, ["manual-tag"]);
});

test("duplicate rows fill only empty values, preserve notion key and populated tags", async () => {
  const original = coach({ notionNo: 1, notionPageId: "original-page", workType: "manual", fields: ["manual-tag"], privateProfile: { employeeId: "manual-id", phone: "same", email: null, birthDate: null, affiliation: "manual" } });
  const fixture = state([original]);
  await runNotionCoachSync([page("Synthetic coach", 2, { 연락처: text("same"), 이메일: text("fill@example.invalid"), 소속: text("overwrite"), "교육 및 가능 분야": { type: "multi_select", multi_select: [{ name: "new-tag" }] }, "가능 커리큘럼": { type: "multi_select", multi_select: [{ name: "new-curriculum" }] } })], fixture.repository, false);
  const updated = fixture.rows[0]; assert.equal(updated.notionNo, 1); assert.equal(updated.notionPageId, "original-page"); assert.equal(updated.privateProfile?.email, "fill@example.invalid"); assert.equal(updated.privateProfile?.affiliation, "manual"); assert.deepEqual(updated.fields, ["manual-tag"]); assert.deepEqual(updated.curriculums, ["new-curriculum"]);
});

test("dry run has no transactions; row failure rolls back and continues with fixed safe details", async () => {
  const fixture = state(); const pages = [page("Fails", 1), page("Succeeds", 2), {}];
  const preview = await runNotionCoachSync(pages, fixture.repository, true); assert.equal(preview.created, 2); assert.equal(preview.skipped, 1); assert.deepEqual(fixture.events, []);
  fixture.fail("Fails"); const result = await runNotionCoachSync(pages, fixture.repository, false);
  assert.equal(result.errors, 1); assert.equal(result.created, 1); assert.deepEqual(result.errorDetail, ["COACH_NOTION_ROW_FAILED"]); assert.deepEqual(fixture.rows.map(row => row.name), ["Succeeds"]);
  assert.deepEqual(fixture.events, ["catalog", "coach", "rollback", "catalog", "coach", "commit"]);
});

test("transaction retries do not duplicate success counters", async () => {
  const fixture = state(); fixture.retry(); const result = await runNotionCoachSync([page()], fixture.repository, false);
  assert.equal(result.created, 1); assert.equal(fixture.rows.length, 1);
});

test("matching a deleted coach updates fields without reviving status or rotating/exposing its token", async () => {
  const deleted = { ...coach({ notionNo: 100 }), deletedAt: new Date("2020-01-01"), status: "INACTIVE", isActive: false, accessToken: "synthetic-private-access-token" };
  const fixture = state([deleted]);
  const preview = await runNotionCoachSync([page()], fixture.repository, true);
  assert.equal(preview.updated, 1); assert.equal(JSON.stringify(preview).includes(deleted.accessToken), false);
  const result = await runNotionCoachSync([page()], fixture.repository, false);
  const saved = fixture.rows[0] as typeof deleted;
  assert.equal(result.updated, 1); assert.deepEqual(saved.deletedAt, deleted.deletedAt); assert.equal(saved.status, "INACTIVE"); assert.equal(saved.isActive, false); assert.equal(saved.accessToken, deleted.accessToken);
  assert.equal(JSON.stringify(result).includes(deleted.accessToken), false);
});


test("duplicate fill decisions use private values re-read after the coach lock", async () => {
  const existing = coach({ notionNo: 1, privateProfile: { employeeId: null, phone: "same", email: null, birthDate: null, affiliation: null } });
  const fixture = state([existing]);
  fixture.beforeLock(() => { fixture.rows[0].privateProfile!.email = "manual-under-lock@example.invalid"; });
  const result = await runNotionCoachSync([page("Synthetic coach", 2, { 연락처: text("same"), 이메일: text("source@example.invalid") })], fixture.repository, false);
  assert.equal(result.updated, 1); assert.equal(fixture.rows[0].privateProfile?.email, "manual-under-lock@example.invalid");
});
