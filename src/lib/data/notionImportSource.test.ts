/** V3: frozen/current real Notion reader AND JSON parser; synthetic fetch only.
 * No database, environment loading, live HTTP, or replacement parser/mapper.
 * This suite proves reader results, not handler persistence/rollback (V4/V5).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock, test } from "node:test";
import * as current from "./notionImport";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { frozen, verifyClosure } from "../../../.claude/plans/mongodb-notion-import/original/frozen-loader.fixture.ts";

type Reader = Pick<typeof current, "readNotionDatabaseImport">;
const TOKEN = "synthetic-notion-http-token";
const DB = "abcdef01-2345-6789-abcd-ef0123456789";
const COMPACT = "abcdef0123456789abcdef0123456789";
const PAGE = "11111111-2222-3333-4444-555555555555";
const OPERATION = "NOTION-11111111222233334444555555555555";
const ID_ERROR = "Notion 데이터베이스 URL 또는 ID를 확인해 주세요.";
const PERMISSION = "Notion 통합 토큰 권한이 없습니다. 해당 데이터베이스에 Notion 통합을 초대했는지 확인해 주세요.";

interface Step {
  cursor?: string;
  payload?: unknown;
  status?: number;
  statusText?: string;
  transportError?: Error;
  jsonError?: Error;
  rawBody?: string;
}
async function transport<T>(steps: readonly Step[], work: () => Promise<T>, databaseId = DB): Promise<T> {
  let calls = 0;
  const violations: unknown[] = [];
  const patch = mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const step = steps[calls++];
    try {
      assert.ok(step, "unexpected extra fetch/retry; synthetic transport never delegates to network");
      assert.equal(input, `https://api.notion.com/v1/databases/${databaseId}/query`);
      assert.deepEqual(options, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
        body: step.cursor === undefined ? '{"page_size":100}' : JSON.stringify({ page_size: 100, start_cursor: step.cursor }),
        cache: "no-store"
      });
    } catch (error) { violations.push(error); throw error; }
    if (step.transportError) throw step.transportError;
    const response = new Response(step.rawBody ?? JSON.stringify("payload" in step ? step.payload : {}), {
      status: step.status ?? 200, statusText: step.statusText ?? ""
    });
    // Labelled response.json rejection, distinct from malformed JSON bytes below.
    if (step.jsonError) return Object.assign(response, { json: async () => { throw step.jsonError; } });
    return response;
  });
  try { return await work(); }
  finally {
    patch.mock.restore();
    assert.deepEqual(violations, [], "request assertion failures must not be swallowed by reader catches");
    assert.equal(calls, steps.length, "every planned page requested exactly once; no cache/early mapping/retry");
  }
}

const page = (properties: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id: PAGE, properties, ...extra });
const rich = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
const title = (value: string) => ({ type: "title", title: [{ plain_text: value }] });

// Only the documented hash primitive is calculated here. Snapshots, field
// mappings, validation errors and ordering are hand-specified, never obtained
// from either reader, parser, FIELD_ALIASES or presenter under test.
function expectedRow(snapshot: Record<string, string>, mapped: Record<string, string>, rowNumber = 2, errors: string[] = []) {
  const canonicalPairs = Object.entries(snapshot).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return { rowNumber, rowSnapshot: snapshot, mappedFields: mapped, unmappedFields: {}, validationErrors: errors,
    sourceFingerprint: createHash("sha256").update(JSON.stringify(canonicalPairs)).digest("hex") };
}
function minimal(rowNumber = 2, operationId = OPERATION) {
  const row = expectedRow({ "운영ID": operationId }, { operationId }, rowNumber);
  // Pinned independently from the literal UTF-8 pair array, not reader output.
  if (operationId === OPERATION) row.sourceFingerprint = "0fc6d0966427e8a9195e547d4eb786b06df152ba43ac502b9e9700a0a4470e36";
  return row;
}
const result = (rows: ReturnType<typeof expectedRow>[], databaseId = DB) => ({ databaseId, parsed: { headerRowNumber: 1, rows }, rowCount: rows.length });
async function readPages(helper: Reader, pages: unknown[], expected: ReturnType<typeof result>) {
  const actual = await transport([{ payload: { results: pages, has_more: false } }], () =>
    helper.readNotionDatabaseImport({ databaseUrlOrId: COMPACT, token: TOKEN }));
  assert.deepEqual(actual, expected);
  return actual;
}

// Literal Notion alias contract, including every alias and its precedence.
// Every alias becomes the first nonempty candidate once; later candidates have
// different text, and insertion order is reversed to catch order-based lookup.
const ALIASES = [
  { names: ["조교명", "조교", "Coach"], key: "코치", field: "coach" },
  { names: ["기업명", "회사명", "Company", "기업"], key: "기업명", field: "companyName" },
  { names: ["과정명", "Course", "교육명"], key: "과정명", field: "courseName" },
  { names: ["교육형태", "운영형태", "진행방식"], key: "교육형태", field: "educationFormat" },
  { names: ["강의관리", "강사", "Instructor", "강사명"], key: "강사", field: "instructors" },
  { names: ["기획", "LD", "Planner", "담당LD"], key: "담당LD", field: "ld" },
  { names: ["운영", "OM", "담당자", "담당OM"], key: "담당OM", field: "om" },
  { names: ["상태", "진행상태", "운영상태"], key: "상태", field: "operationStatus" },
  { names: ["강의장소", "장소", "Location", "지역"], key: "지역", field: "region" },
  { names: ["차수", "회차", "Round"], key: "차수", field: "roundNo" },
  { names: ["Tags", "태그", "메모", "특이사항"], key: "특이사항", field: "specialNotes" },
  { names: ["시간", "교육시간", "Time"], key: "시간", field: "timeText" }
] as const;

test("Notion V3 frozen/current actual reader and JSON parser with independent whole results", async suite => {
  verifyClosure();
  const original = await frozen<Reader>("src/lib/data/notionImport.ts");
  for (const [backend, helper] of [["original", original], ["current", current]] as const) {
    await suite.test(`${backend}: ID extraction is compact-first, case/host permissive; invalid ID fetch0`, async () => {
      const other = "99999999-8888-7777-6666-555555555555";
      for (const [input, expectedId] of [
        [COMPACT, DB], [DB, DB], [COMPACT.toUpperCase(), DB.toUpperCase()], [DB.toUpperCase(), DB.toUpperCase()],
        [`  https://example.invalid/${COMPACT}?v=ignored  `, DB], [`not-a-url ${DB}`, DB],
        [`${other} then ${COMPACT}`, DB], [`${COMPACT} then ${other}`, DB]
      ]) {
        const actual = await transport([{ payload: { results: [] } }], () =>
          helper.readNotionDatabaseImport({ databaseUrlOrId: input, token: TOKEN }), expectedId);
        assert.deepEqual(actual, result([], expectedId));
      }
      for (const invalid of ["", "   ", "https://notion.so/no-database", "g".repeat(32)]) {
        await assert.rejects(transport([], () => helper.readNotionDatabaseImport({ databaseUrlOrId: invalid, token: TOKEN })), { message: ID_ERROR });
      }
    });

    for (const alias of ALIASES) {
      await suite.test(`${backend}: all ${alias.field} aliases use first nonempty, not object insertion order`, async () => {
        for (let chosen = 0; chosen < alias.names.length; chosen++) {
          const properties = Object.fromEntries(alias.names.map((name, index) => [name,
            rich(index < chosen ? "  " : `  candidate-${index}  `)]).reverse());
          await readPages(helper, [page(properties)], result([expectedRow(
            { "운영ID": OPERATION, [alias.key]: `candidate-${chosen}` },
            { operationId: OPERATION, [alias.field]: `candidate-${chosen}` }
          )]));
        }
        await readPages(helper, [page(Object.fromEntries(alias.names.map(name => [name, rich(" ")])) )], result([minimal()]));
      });
    }

    await suite.test(`${backend}: all date aliases, truthy start, slice10 and end null/absent/empty`, async () => {
      const aliases = ["Date", "날짜", "일정", "교육일"];
      const dates = ["2031-01-02", "2032-02-03", "2033-03-04", "2034-04-05"];
      for (let chosen = 0; chosen < aliases.length; chosen++) {
        const properties = Object.fromEntries(aliases.map((name, index) => [name, {
          type: "date", date: { start: index < chosen ? "" : `${dates[index]}T23:45:00+09:00`, end: null }
        }]).reverse());
        await readPages(helper, [page(properties)], result([expectedRow(
          { "운영ID": OPERATION, "시작일": dates[chosen], "종료일": dates[chosen] },
          { operationId: OPERATION, startDate: dates[chosen], endDate: dates[chosen] }
        )]));
      }
      const dateCases: Array<[Record<string, string>, Record<string, string>, Record<string, string>]> = [
        [{ start: "2031-09-30T10:00:00Z" }, { "시작일": "2031-09-30", "종료일": "2031-09-30" }, { startDate: "2031-09-30", endDate: "2031-09-30" }],
        [{ start: "2031-09-30", end: "" }, { "시작일": "2031-09-30" }, { startDate: "2031-09-30" }],
        [{ start: "2031-09-30", end: "2031-10-01T00:00:00Z" }, { "시작일": "2031-09-30", "종료일": "2031-10-01" }, { startDate: "2031-09-30", endDate: "2031-10-01" }]
      ];
      for (const [date, snapshot, mapped] of dateCases) {
        await readPages(helper, [page({ Date: { type: "date", date } })], result([expectedRow(
          { "운영ID": OPERATION, ...snapshot }, { operationId: OPERATION, ...mapped }
        )]));
      }
      await readPages(helper, [page({ Date: rich("ignored"), 날짜: { type: "date", date: null } })], result([minimal()]));
      await readPages(helper, [page({ Date: { type: "date", date: { start: "2031/9/3", end: "2031/9/4" } } })], result([expectedRow(
        { "운영ID": OPERATION, "시작일": "2031/9/3", "종료일": "2031/9/4" },
        { operationId: OPERATION, startDate: "2031-09-03", endDate: "2031-09-04" }
      )]));
      await readPages(helper, [page({ Date: { type: "date", date: { start: "not-a-date", end: "bad-end" } } })], result([expectedRow(
        { "운영ID": OPERATION, "시작일": "not-a-date", "종료일": "bad-end" },
        { operationId: OPERATION, startDate: "not-a-date", endDate: "bad-end" }, 2,
        ["시작일 형식을 확인해야 합니다.", "종료일 형식을 확인해야 합니다."]
      )]));
    });

    await suite.test(`${backend}: title fallback uses first nonempty title; course alias wins after eager title evaluation`, async () => {
      const properties = { first: title(" "), second: title(" First title "), third: title("Later title") };
      await readPages(helper, [page(properties)], result([expectedRow(
        { "운영ID": OPERATION, "과정명": "First title" }, { operationId: OPERATION, courseName: "First title" }
      )]));
      await readPages(helper, [page({ ...properties, Course: rich("Alias course") })], result([expectedRow(
        { "운영ID": OPERATION, "과정명": "Alias course" }, { operationId: OPERATION, courseName: "Alias course" }
      )]));
    });

    await suite.test(`${backend}: property type conversions and omissions feed real JSON parser`, async () => {
      const conversions: Array<{ property: unknown; text: string | null }> = [
        { property: { type: "title", title: [null, 7, { plain_text: "  A" }, {}, { plain_text: "B  " }] }, text: "AB" },
        { property: { type: "rich_text", rich_text: [{ plain_text: "  A" }, { plain_text: "B  " }] }, text: "AB" },
        { property: { type: "title", title: "bad" }, text: null },
        { property: { type: "rich_text", rich_text: null }, text: null },
        { property: { type: "multi_select", multi_select: [{ name: " A " }, null, { name: " " }, { name: "B" }, { name: 2 }] }, text: "A, B" },
        { property: { type: "people", people: [{ name: " A " }, {}, { name: "B" }] }, text: "A, B" },
        { property: { type: "people", people: "bad" }, text: null },
        { property: { type: "select", select: { name: " Choice " } }, text: "Choice" },
        { property: { type: "status", status: { name: " Ready " } }, text: "Ready" },
        { property: { type: "select", select: { name: 123 } }, text: null },
        { property: { type: "status", status: null }, text: null },
        { property: { type: "url", url: " https://example.invalid/synthetic " }, text: "https://example.invalid/synthetic" },
        { property: { type: "url", url: false }, text: null },
        { property: { type: "date", date: { start: "2031-09-30T10:00:00Z" } }, text: "2031-09-30" },
        { property: { type: "formula", formula: { type: "string", string: " Formula " } }, text: "Formula" },
        { property: { type: "formula", formula: { type: "number", number: 0 } }, text: "0" },
        { property: { type: "formula", formula: { type: "boolean", boolean: false } }, text: "false" },
        { property: { type: "formula", formula: { type: "number", number: "0" } }, text: null },
        { property: { type: "formula", formula: { type: "date", date: { start: "2031-01-01" } } }, text: null },
        { property: { type: "number", number: 42 }, text: null },
        { property: { type: "relation", relation: [{ id: PAGE }] }, text: null }
      ];
      for (const item of conversions) {
        // Put the type at Course: title fallback and alias select the same value.
        const snapshot: Record<string, string> = item.text === null ? { "운영ID": OPERATION } : { "운영ID": OPERATION, "과정명": item.text };
        const mapped: Record<string, string> = item.text === null ? { operationId: OPERATION } : { operationId: OPERATION, courseName: item.text };
        await readPages(helper, [page({ Course: item.property, neverMapped: rich("DO_NOT_PRESERVE_UNKNOWN_PROPERTY") })], result([expectedRow(snapshot, mapped)]));
      }
      await readPages(helper, [page({}, { url: " https://example.invalid/page " }), { id: PAGE }, page({}, { properties: null })], result([
        expectedRow({ "운영ID": OPERATION, "싱크업": "https://example.invalid/page" }, { operationId: OPERATION, operationDetail: "https://example.invalid/page" }),
        minimal(3), minimal(4)
      ]));
    });

    await suite.test(`${backend}: three pages with empty middle preserve order/multiplicity and JSON row numbers`, async () => {
      const secondId = "99999999-8888-7777-6666-555555555555";
      const steps = [
        { payload: { results: [page()], has_more: true, next_cursor: "cursor-A" } },
        { cursor: "cursor-A", payload: { results: [], has_more: true, next_cursor: "cursor-B" } },
        { cursor: "cursor-B", payload: { results: [page({}, { id: secondId }), page()], has_more: false, next_cursor: "ignored" } }
      ];
      const actual = await transport(steps, () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN }));
      const expected = result([minimal(), minimal(3, "NOTION-99999999888877776666555555555555"), minimal(4)]);
      assert.deepEqual(actual, expected);
      // Whole-result oracle rejects changes to count, fields, rows and order.
      const mutations = [
        { ...actual, rowCount: 2 },
        { ...actual, extra: true },
        { ...actual, parsed: { ...actual.parsed, rows: actual.parsed.rows.slice(0, 2) } },
        { ...actual, parsed: { ...actual.parsed, rows: [actual.parsed.rows[1], actual.parsed.rows[0], actual.parsed.rows[2]] } }
      ];
      for (const mutation of mutations) assert.throws(() => assert.deepEqual(mutation, expected));
    });

    await suite.test(`${backend}: termination uses has_more and truthy cursor; missing/null results stay empty`, async () => {
      for (const payload of [
        {}, { results: null }, { results: [] },
        { results: [page()], has_more: false, next_cursor: "ignored" },
        { results: [page()], has_more: true, next_cursor: null },
        { results: [page()], has_more: true },
        { results: [page()], has_more: true, next_cursor: "" }
      ]) {
        const actual = await transport([{ payload }], () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN }));
        assert.deepEqual(actual, result("results" in payload && Array.isArray(payload.results) && payload.results.length ? [minimal()] : []));
      }
    });

    await suite.test(`${backend}: repeated cursor has no new product cap; finite synthetic tripwire ends repetition`, async () => {
      const stop = new Error("SYNTHETIC_CURSOR_CYCLE_STOP_AFTER_FOUR_FETCHES");
      await assert.rejects(transport([
        { payload: { results: [], has_more: true, next_cursor: "same" } },
        { cursor: "same", payload: { results: [], has_more: true, next_cursor: "same" } },
        { cursor: "same", payload: { results: [], has_more: true, next_cursor: "same" } },
        { cursor: "same", transportError: stop }
      ], () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN })), error => error === stop);
    });

    await suite.test(`${backend}: late HTTP/JSON/transport failures precede mapping malformed earlier page`, async () => {
      for (const firstPage of [page(), page({ Course: rich("valid alias"), unrelated: null }), { properties: {} }]) {
        for (const status of [401, 403, 429, 500]) {
          const expected = status === 401 || status === 403 ? PERMISSION : `Notion 데이터베이스를 읽지 못했습니다. ${status} SYNTHETIC_PRIVATE_STATUS`;
          await assert.rejects(transport([
            { payload: { results: [firstPage], has_more: true, next_cursor: "late" } },
            { cursor: "late", status, statusText: "SYNTHETIC_PRIVATE_STATUS", payload: { error: "private response body" } }
          ], () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN })), { message: expected });
        }
        for (const lane of ["transportError", "jsonError"] as const) {
          const failure = new Error(`SYNTHETIC_LATE_${lane}`);
          await assert.rejects(transport([
            { payload: { results: [firstPage], has_more: true, next_cursor: "late" } },
            { cursor: "late", [lane]: failure }
          ], () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN })), error => error === failure);
        }
        // Actual Response.json decoding failure, not the labelled method fault above.
        await assert.rejects(transport([
          { payload: { results: [firstPage], has_more: true, next_cursor: "late" } },
          { cursor: "late", rawBody: "{" }
        ], () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN })), SyntaxError);
      }
    });

    await suite.test(`${backend}: JSON-possible malformed inputs fail after all fetches; no streaming map`, async () => {
      const malformedPages: unknown[] = [
        { properties: {} }, page({}, { id: null }), page({}, { id: 123 }),
        page({ Course: rich("valid alias"), unrelated: null }),
        page({ Date: { type: "date", date: { start: 123 } } }),
        page({ Date: { type: "date", date: { start: "2031-09-30", end: 123 } } }),
        page({}, { url: 123 }), page({}, { url: false }), null
      ];
      for (const malformed of malformedPages) {
        await assert.rejects(transport([
          { payload: { results: [malformed], has_more: true, next_cursor: "still-fetch" } },
          { cursor: "still-fetch", payload: { results: [page()], has_more: false } }
        ], () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN })), TypeError);
      }
      for (const payload of [null, { results: {} }, { results: 42 }, { results: "x" }]) {
        await assert.rejects(transport([{ payload }], () => helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN })), TypeError);
      }
    });

    await suite.test(`${backend}: eager date then ID then title failures are distinguishable even with valid Course`, async () => {
      const cases = [
        { input: page({ Date: { type: "date", date: { start: 123 } }, Course: rich("valid"), unrelated: null }, { id: 123 }), message: /slice/ },
        { input: page({ Course: rich("valid"), unrelated: null }, { id: 123 }), message: /replaceAll/ },
        { input: page({ Course: rich("valid"), unrelated: null }), message: /type/ }
      ];
      for (const item of cases) {
        await assert.rejects(transport([{ payload: { results: [item.input] } }], () =>
          helper.readNotionDatabaseImport({ databaseUrlOrId: DB, token: TOKEN })), error => {
          assert.ok(error instanceof TypeError);
          assert.match(error.message, item.message); return true;
        });
      }
    });
  }
});

test("Notion source selection retains real reader identity and explicit missing-scope failure", async () => {
  const { getNotionImportSource } = await import("./notionImportSource");
  assert.equal(getNotionImportSource().readDatabase, current.readNotionDatabaseImport);
  const patch = mock.method(globalThis, "fetch", async () => { assert.fail("source resolution must perform no HTTP"); });
  try {
    assert.throws(() => runWithDataRepositories({}, () => getNotionImportSource()), { message: "DATA_REPOSITORY_NOT_CONFIGURED: notionImportSource" });
    const source = { readDatabase: async () => result([]) };
    assert.equal(runWithDataRepositories({ notionImportSource: source }, () => getNotionImportSource()), source);
    assert.equal(getNotionImportSource().readDatabase, current.readNotionDatabaseImport);
    assert.equal(patch.mock.callCount(), 0);
  } finally { patch.mock.restore(); }
});
