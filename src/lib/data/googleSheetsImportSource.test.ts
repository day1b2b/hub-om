/** V2: real frozen/current HTTP helpers, synthetic transport only; no live network. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import * as current from "./googleSheetsImport";
import { getGoogleSheetsImportSource } from "./googleSheetsImportSource";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { frozen, verifyClosure } from "../../../.claude/plans/mongodb-google-sheets-import/original/frozen-loader.fixture.ts";

type Helpers = typeof current;
const TOKEN = "SYNTHETIC_SHEETS_HTTP_TOKEN";
const SHEET = "SYNTHETIC_SHEET";
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const TABS_URL = `${BASE}?fields=sheets(properties(sheetId,title,index))`;
const RANGE_URL = `${BASE}/values/'%20A''%ED%95%9C%20%2F%20'!A1%3AZZ2000?majorDimension=ROWS`;
const PERMISSION = "스프레드시트를 읽을 권한이 없습니다. Google로 다시 로그인해 권한을 허용해 주세요.";
const READ_FAILURE = "Google 스프레드시트를 읽지 못했습니다.";
async function transport<T>(url: string, response: () => Promise<Response>, work: () => Promise<T>) {
  let count = 0;
  const patch = mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    count++;
    assert.equal(input, url);
    assert.deepEqual(options, { headers: { authorization: `Bearer ${TOKEN}` } });
    return response();
  });
  try { return await work(); }
  finally { patch.mock.restore(); assert.equal(count, 1, "no retry, cache or extra HTTP call"); }
}
const json = (value: unknown, status = 200) => async () => new Response(JSON.stringify(value), { status });

test("Sheets HTTP helpers: original/current independent request and response literals", async suite => {
  verifyClosure();
  const original = await frozen<Helpers>("src/lib/data/googleSheetsImport.ts");
  for (const [backend, helper] of [["original", original], ["current", current]] as const) {
    await suite.test(`${backend}: URL/gid keeps existing permissive parsing`, () => {
      for (const [input, gid] of [
        [`  https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=2#gid=9  `, 2],
        [`https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=9`, 9],
        [`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=0`, 0],
        [`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=-2.5`, -2.5],
        [`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=Infinity`, null],
        [`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=abc`, null],
        [`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=#gid=9`, null],
        [`https://example.invalid/spreadsheets/d/${SHEET}/edit`, null],
        [`not-a-url/spreadsheets/d/${SHEET}`, null]
      ] as const) assert.deepEqual(helper.parseGoogleSpreadsheetUrl(input), { spreadsheetId: SHEET, gid });
      assert.throws(() => helper.parseGoogleSpreadsheetUrl("bad"), { message: "Google 스프레드시트 URL을 확인해 주세요." });
    });
    await suite.test(`${backend}: tab response order differs from index order`, async () => {
      const payload = { sheets: [
        { properties: { sheetId: 9, title: "Synthetic first", index: 99 } },
        { properties: { sheetId: 0, title: "", index: 0 } },
        { properties: { sheetId: "invalid", title: "omit" } },
        { properties: { sheetId: 2, title: null } }, {}, { properties: null }
      ] };
      const result = await transport(TABS_URL, json(payload), () => helper.listGoogleSheetTabs(TOKEN, SHEET));
      assert.deepEqual(result, [{ gid: 9, title: "Synthetic first" }, { gid: 0, title: "" }]);
      assert.throws(() => assert.deepEqual([...result].reverse(), [{ gid: 9, title: "Synthetic first" }, { gid: 0, title: "" }]));
    });
    await suite.test(`${backend}: absent/null tabs and malformed container`, async () => {
      for (const payload of [{}, { sheets: null }]) assert.deepEqual(await transport(TABS_URL, json(payload), () => helper.listGoogleSheetTabs(TOKEN, SHEET)), []);
      await assert.rejects(transport(TABS_URL, json({ sheets: "bad" }), () => helper.listGoogleSheetTabs(TOKEN, SHEET)), TypeError);
    });
    await suite.test(`${backend}: quoted Unicode range and raw scalar/malformed row preservation`, async () => {
      const raw = [["head"], [123, false, null, ""], null];
      const result = await transport(RANGE_URL, json({ values: raw }), () => helper.readGoogleSheetRows(TOKEN, SHEET, " A'한 / "));
      assert.deepEqual(result, raw, "helper preserves payload; parser determines later meaning");
      for (const payload of [{}, { values: null }, { values: [] }]) {
        assert.deepEqual(await transport(RANGE_URL, json(payload), () => helper.readGoogleSheetRows(TOKEN, SHEET, " A'한 / ")), []);
      }
    });
    await suite.test(`${backend}: HTTP errors never expose response body`, async () => {
      for (const status of [401, 403, 429, 500]) {
        const expected = status === 401 || status === 403 ? PERMISSION : READ_FAILURE;
        for (const action of ["tabs", "rows"] as const) {
          const url = action === "tabs" ? TABS_URL : RANGE_URL;
          const work: () => Promise<unknown> = () => action === "tabs" ? helper.listGoogleSheetTabs(TOKEN, SHEET) : helper.readGoogleSheetRows(TOKEN, SHEET, " A'한 / ");
          await assert.rejects(transport(url, json({ error: "SYNTHETIC_PRIVATE_RESPONSE" }, status), work), { message: expected });
        }
      }
    });
    await suite.test(`${backend}: transport/JSON failures remain helper exceptions`, async () => {
      for (const action of ["tabs", "rows"] as const) {
        const url = action === "tabs" ? TABS_URL : RANGE_URL;
        const work: () => Promise<unknown> = () => action === "tabs" ? helper.listGoogleSheetTabs(TOKEN, SHEET) : helper.readGoogleSheetRows(TOKEN, SHEET, " A'한 / ");
        const failure = new Error("SYNTHETIC_PRIVATE_HELPER_FAILURE");
        await assert.rejects(transport(url, async () => { throw failure; }, work), error => error === failure);
        await assert.rejects(transport(url, async () => Object.assign(new Response("{}"), { json: async () => { throw failure; } }), work), error => error === failure);
      }
    });
  }
});

test("Sheets source selection is explicit and defaults to unchanged HTTP exports", () => {
  const selected = getGoogleSheetsImportSource();
  assert.equal(selected.listTabs, current.listGoogleSheetTabs);
  assert.equal(selected.readRows, current.readGoogleSheetRows);
  assert.throws(() => runWithDataRepositories({}, () => getGoogleSheetsImportSource()), { message: "DATA_REPOSITORY_NOT_CONFIGURED: googleSheetsImportSource" });
  const source = { listTabs: async () => [], readRows: async () => [] };
  assert.equal(runWithDataRepositories({ googleSheetsImportSource: source }, () => getGoogleSheetsImportSource()), source);
});
