import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { runNotionInstructorSync } from "./instructorNotionSyncWorkflow";
import { runWithDataRepositories } from "../data/dataRepositoryContext";
import { getInstructorNotionSource, getInstructorNotionSyncRepository } from "../data/instructorNotionSyncRepositoryFactory";
import { PrismaInstructorNotionSyncRepository } from "../data/prismaInstructorNotionSyncRepository";
import type { InstructorNotionSyncRepository } from "../data/instructorNotionSyncRepository";

mock.module("@/auth", { namedExports: { auth: async () => null } });
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/navigation" ? "next/navigation.js" : specifier, context);
} });
const { readNotionInstructorPages, syncNotionInstructors } = await import("./notionInstructorSync");
hook.deregister();
const page = (name = "Synthetic instructor", number = 1) => ({ properties: {
  "강사명": { type: "title", title: [{ plain_text: name }] }, "ID": { type: "unique_id", unique_id: { number } }
} });
const repository = (overrides: Partial<InstructorNotionSyncRepository> = {}): InstructorNotionSyncRepository => ({
  initialize() {}, async findMatch() { return { target: null, by: "none" }; }, async applyRecord() { return "created"; }, ...overrides
});

test("instructor workflow preserves initialization, row failures and mapping failure phases", async () => {
  for (const pages of [[], [{}], [page()]]) {
    let initialized = 0, queried = 0;
    const repo = repository({ initialize() { initialized++; throw new Error("synthetic private driver payload"); },
      async findMatch() { queried++; throw new Error("unexpected"); } });
    for (const dryRun of [false, true]) {
      await assert.rejects(runNotionInstructorSync(pages, repo, dryRun), { message: "INSTRUCTOR_NOTION_INITIALIZE_FAILED" });
    }
    assert.equal(initialized, 2); assert.equal(queried, 0);
  }
  let applied = 0;
  const repo = repository({ async applyRecord(record) {
    if (record.notionNo === 2) throw new Error("Synthetic secret error");
    applied++; return "created";
  } });
  const result = await runNotionInstructorSync([page("One", 1), page("Two", 2), {}, page("Three", 3)], repo, false);
  assert.deepEqual(result, { totalRows: 4, created: 2, updated: 0, skipped: 1, errors: 1, errorDetail: ["INSTRUCTOR_NOTION_ROW_FAILED"], changes: undefined });
  assert.equal(applied, 2);
  const corrupt = { get properties(): never { throw new Error("Private mapping payload"); } };
  await assert.rejects(runNotionInstructorSync([page(), corrupt], repo, false), { message: "INSTRUCTOR_NOTION_MAPPING_FAILED" });
  assert.equal(applied, 3, "previous row remains committed before mapping failure");
  const preview = await runNotionInstructorSync([page(), page()], repository(), true);
  assert.equal(preview.created, 2); assert.equal(preview.changes?.length, 2);
});

test("instructor explicit context resolves both ports before source and blocks direct PG", async () => {
  let sourceCalls = 0, initialized = 0;
  const source = { async readPages() { sourceCalls++; return []; } };
  const repo = repository({ initialize() { initialized++; } });
  assert.ok(getInstructorNotionSyncRepository() instanceof PrismaInstructorNotionSyncRepository);
  assert.equal(typeof getInstructorNotionSource().readPages, "function");
  for (const scope of [{}, { instructorNotionSync: repo }, { instructorNotionSource: source }]) {
    await assert.rejects(runWithDataRepositories(scope, () => syncNotionInstructors(true)), /DATA_REPOSITORY_NOT_CONFIGURED/);
  }
  assert.equal(sourceCalls, 0); assert.equal(initialized, 0);
  await runWithDataRepositories({ instructorNotionSync: repo, instructorNotionSource: source }, async () => {
    assert.equal(getInstructorNotionSyncRepository(), repo);
    await syncNotionInstructors(true);
    const pg = new PrismaInstructorNotionSyncRepository();
    assert.throws(() => pg.initialize(), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    const record = { name: "Synthetic", notionNo: 1, note: {} };
    await assert.rejects(pg.findMatch(record), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(pg.applyRecord(record), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await runWithDataRepositories({ instructorNotionSync: repository() }, async () => {
      assert.notEqual(getInstructorNotionSyncRepository(), repo);
      assert.throws(() => getInstructorNotionSource(), /DATA_REPOSITORY_NOT_CONFIGURED/);
    });
    assert.equal(getInstructorNotionSyncRepository(), repo);
  });
  assert.equal(sourceCalls, 1); assert.equal(initialized, 1);
  await assert.rejects(runWithDataRepositories({ instructorNotionSync: repo, instructorNotionSource: { async readPages() { throw new Error("Synthetic private source"); } } }, () => syncNotionInstructors(false)), { message: "INSTRUCTOR_NOTION_SOURCE_FAILED" });
  assert.equal(initialized, 1);
});

test("default instructor source keeps pagination and hides config, body, JSON and network failures", async () => {
  const keys = ["NOTION_TOKEN", "NOTION_API_KEY", "INSTRUCTOR_NOTION_DATABASE_ID", "NOTION_INSTRUCTOR_DATABASE_ID"];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  let calls: { url: string; body: unknown; headers: Headers }[] = [];
  let responses: (() => Promise<Response>)[] = [];
  const fetch = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const response = responses.shift(); assert.ok(response, "No real external call allowed"); return response();
  });
  try {
    await assert.rejects(readNotionInstructorPages(), { message: "INSTRUCTOR_NOTION_SOURCE_FAILED" });
    assert.equal(calls.length, 0);
    process.env.NOTION_API_KEY = " synthetic-test-key "; process.env.NOTION_INSTRUCTOR_DATABASE_ID = " synthetic-test-database ";
    responses = [async () => Response.json({ results: [page(), null, 1], has_more: true, next_cursor: "synthetic-next" }),
      async () => Response.json({ results: [page("Second")], has_more: false })];
    assert.deepEqual(await readNotionInstructorPages(), [page(), page("Second")]);
    assert.deepEqual(calls.map(call => call.body), [{ page_size: 100 }, { page_size: 100, start_cursor: "synthetic-next" }]);
    assert.equal(calls[0].headers.get("authorization"), "Bearer synthetic-test-key");
    assert.equal(calls[0].headers.get("notion-version"), "2022-06-28");
    assert.equal(calls[0].url, "https://api.notion.com/v1/databases/synthetic-test-database/query");
    process.env.NOTION_TOKEN = "primary-synthetic"; process.env.INSTRUCTOR_NOTION_DATABASE_ID = "primary-database";
    for (const payload of [{ results: "wrong", has_more: false }, { results: [], has_more: true, next_cursor: 1 }]) {
      responses = [async () => Response.json(payload)]; calls = [];
      assert.deepEqual(await readNotionInstructorPages(), []); assert.equal(calls.length, 1);
      assert.equal(calls[0].headers.get("authorization"), "Bearer primary-synthetic");
    }
    for (const fail of [async () => new Response("PRIVATE SOURCE BODY", { status: 500 }),
      async () => new Response("PRIVATE INVALID JSON"), async (): Promise<Response> => { throw new Error("PRIVATE network payload"); }]) {
      responses = [async () => Response.json({ results: [page()], has_more: true, next_cursor: "next" }), fail];
      let initialize = 0, apply = 0;
      const repo = repository({ initialize() { initialize++; }, async applyRecord() { apply++; return "created"; } });
      await assert.rejects(runWithDataRepositories({ instructorNotionSync: repo, instructorNotionSource: { readPages: readNotionInstructorPages } }, () => syncNotionInstructors(false)), { message: "INSTRUCTOR_NOTION_SOURCE_FAILED" });
      assert.equal(initialize, 0); assert.equal(apply, 0);
    }
  } finally {
    fetch.mock.restore();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
