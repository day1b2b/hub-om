import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetReadError, sheetHttpError } from "./googleServiceAccount";

const googleError = (status: string, message: string) => JSON.stringify({ error: { code: 400, status, message } });

test("sheet HTTP failures are classified by status and Google error, without keeping the body", () => {
  const rangeBody = googleError("INVALID_ARGUMENT", "Unable to parse range: '조교실습코치_일반계약요청'!A:Q");
  const cases: Array<[number, string, string]> = [
    [401, googleError("UNAUTHENTICATED", "Request had invalid authentication credentials."), "auth_failed"],
    [403, googleError("PERMISSION_DENIED", "The caller does not have permission"), "forbidden"],
    [404, googleError("NOT_FOUND", "Requested entity was not found."), "not_found"],
    [400, rangeBody, "bad_range"],
    [400, googleError("INVALID_ARGUMENT", "Something else"), "http"],
    [500, "<html>private sheet body</html>", "http"]
  ];
  for (const [status, body, kind] of cases) {
    const error = sheetHttpError("Google Sheets read", status, body);
    assert.ok(error instanceof GoogleSheetReadError);
    assert.equal(error.kind, kind);
    assert.equal(error.status, status);
    assert.equal(error.message, `Google Sheets read failed (${status})`);
    assert.doesNotMatch(error.message, /private sheet body|parse range/);
  }
  assert.equal(sheetHttpError("Google Sheets read", 403, googleError("PERMISSION_DENIED", "x")).code, "PERMISSION_DENIED");
  assert.equal(sheetHttpError("Google Sheets read", 500, "not json").code, null);
});
