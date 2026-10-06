/** Synthetic HTTP/literal oracle only. No copied source implementation or private examples. */
import assert from "node:assert/strict";
import { verify } from "node:crypto";
import type { DriveImportOperation } from "./driveImportWriterRepository";
import type { DriveImportScanResult, DriveFolderSearchResult } from "../driveImports/driveImportTypes";

export const URI = "mongodb://127.0.0.1:27853/?replicaSet=drivewriter20260930";
export const ROOT = "/private/tmp/hub-om-drive-writer-20260930";
export const TOKEN = "synthetic-drive-source-access-token";
export const CANARY = "synthetic-drive-source-error-canary@example.invalid";
export const LINK = "https://example.invalid/folders/fixture-folder";
export const FOLDER_URL = "https://example.invalid/folder";
export const SHEET_URL = "https://example.invalid/sheet";
export const TITLE = "FixtureFolder";
export const SEARCH_TITLE = "3202_FixtureOrg_FixtureCourse";
export const CASES = ["scan", "reference", "search", "missing_config", "oauth_error", "metadata_error",
  "search_http_error", "search_partial", "search_reject", "sheet_http_error", "sheet_reject"] as const;
export type Scenario = typeof CASES[number];
export const isSearch = (scenario: Scenario) => scenario.startsWith("search");
export const SCAN_ISSUE = "Google Drive 폴더를 읽지 못했습니다. 서비스 계정 공유 권한과 환경변수를 확인해야 합니다.";
export const BODY_ISSUE = "본문까지 읽힌 싱크업 문서가 없어 파일명/폴더명 중심 후보만 생성했습니다.";
export const EMPTY_SEARCH = "과정명/기업명 기준으로 Drive 폴더 후보를 찾지 못했습니다.";
export const SEARCH_ISSUE = "Google Drive 폴더 검색에 실패했습니다. 서비스 계정 권한과 공유 범위를 확인해야 합니다.";
export const CONFIG_ISSUES = ["GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL 또는 GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL 설정이 필요합니다.",
  "GOOGLE_DRIVE_PRIVATE_KEY 또는 GOOGLE_CALENDAR_PRIVATE_KEY 설정이 필요합니다."];
export const OP = "SYNTHETIC-DRIVE-SOURCE";
export function operation(id: string, scenario: Scenario): DriveImportOperation {
  return { id, operationId: OP, companyName: "FixtureOrg", courseName: "FixtureCourse", startDate: "2032-02-03", endDate: "2032-02-04",
    om: "", ld: "", driveLink: isSearch(scenario) ? "" : scenario === "reference" ? TITLE : LINK, lectureManagementLink: "" };
}
const origin = "https://www.googleapis.com/drive/v3/files";
const base = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
export const SEARCH_QUERIES = [
  `${base} and name contains 'FixtureOrg'`, `${base} and name contains 'FixtureCourse'`,
  `${base} and name contains '3202'`, `${base} and name contains '3202~3202'`,
  `${base} and (name contains 'FixtureOrg' or name contains 'FixtureCourse' or name contains '3202' or name contains '3202~3202')`
];
const REFERENCE_QUERIES = [`${base} and name contains 'FixtureFolder'`, `${base} and (name contains 'FixtureFolder')`];
const folder = { id: "fixture-folder", name: TITLE, mimeType: "application/vnd.google-apps.folder", webViewLink: FOLDER_URL };
const sheet = { id: "fixture-sheet", name: "강의관리 패들렛", mimeType: "application/vnd.google-apps.spreadsheet", webViewLink: SHEET_URL };
const searchFolder = { id: "fixture-search-folder", name: SEARCH_TITLE, webViewLink: "https://example.invalid/search-folder" };
function url(path: string, parameters: Record<string, string> = {}) { const value = new URL(path); for (const [key, item] of Object.entries(parameters)) value.searchParams.set(key, item); return value; }
function canonical(value: URL) { const copy = new URL(value); copy.searchParams.sort(); return copy.href; }
function queryURL(q: string) { return url(origin, { q, fields: "files(id,name,mimeType,webViewLink,modifiedTime,parents,owners(displayName,emailAddress))",
  pageSize: "50", supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives" }); }
interface Frame { url: URL; payload: unknown; status?: number; reject?: boolean; oauth?: boolean; used?: boolean }
export class HttpOracle {
  readonly attempts: string[] = [];
  readonly violations: string[] = [];
  readonly frames: Frame[];
  readonly publicKey: string;
  readonly forceMetadataViolation: boolean;
  constructor(scenario: Scenario, publicKey: string, cold: boolean, forceMetadataViolation = false) {
    this.publicKey = publicKey; this.forceMetadataViolation = forceMetadataViolation;
    const frames: Frame[] = [];
    this.frames = frames;
    if (scenario === "missing_config") return;
    if (cold) frames.push({ url: new URL("https://oauth2.googleapis.com/token"), oauth: true,
      payload: scenario === "oauth_error" ? { error: CANARY } : { access_token: TOKEN, expires_in: 3600 }, status: scenario === "oauth_error" ? 401 : 200 });
    if (scenario === "oauth_error") return;
    if (isSearch(scenario)) {
      for (const [index, q] of SEARCH_QUERIES.entries()) frames.push({ url: queryURL(q),
        payload: scenario === "search_http_error" || (scenario === "search_partial" && index > 0) ? { error: { message: CANARY } } : { files: [searchFolder] },
        status: scenario === "search_http_error" || (scenario === "search_partial" && index > 0) ? 403 : 200,
        reject: scenario === "search_reject" && index === 0 });
      return;
    }
    if (scenario === "reference") for (const q of REFERENCE_QUERIES) frames.push({ url: queryURL(q), payload: { files: [folder] } });
    else frames.push({ url: url(`${origin}/fixture-folder`, { fields: "id,name,mimeType,webViewLink,modifiedTime,parents", supportsAllDrives: "true" }),
      payload: scenario === "metadata_error" ? { error: { message: CANARY } } : folder, status: scenario === "metadata_error" ? 500 : 200 });
    if (scenario === "metadata_error" || forceMetadataViolation) return;
    frames.push({ url: url(origin, { q: "'fixture-folder' in parents and trashed = false", fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
      pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true" }), payload: { files: [sheet] } });
    frames.push({ url: url("https://sheets.googleapis.com/v4/spreadsheets/fixture-sheet", { includeGridData: "true", fields: "sheets(properties(title),data(rowData(values(formattedValue))))" }),
      payload: scenario === "sheet_http_error" ? { error: { message: CANARY } } : { sheets: [{ data: [{ rowData: [{ values: [{ formattedValue: "교육장소" }, { formattedValue: "FixtureRoom" }] }] }] }] },
      status: scenario === "sheet_http_error" ? 403 : 200, reject: scenario === "sheet_reject" });
  }
  async fetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    // Record before ANY parsing/assertion. Source catches must not hide transport-oracle faults.
    this.attempts.push("entered");
    let frame: Frame;
    try {
      assert.ok(!(input instanceof Request), "UNEXPECTED_REQUEST_OBJECT");
      const requestURL = new URL(String(input));
      this.attempts[this.attempts.length - 1] = canonical(requestURL);
      const match = this.frames.find(item => !item.used && canonical(item.url) === canonical(requestURL));
      assert.ok(match, "UNSCRIPTED_HTTP_ATTEMPT"); frame = match; frame.used = true;
      assert.deepEqual(Object.keys(init ?? {}).sort(), frame.oauth ? ["body", "headers", "method"] : ["headers"]);
      const headers = Object.fromEntries(new Headers(init?.headers));
      if (frame.oauth) {
        assert.equal(init?.method, "POST"); assert.deepEqual(headers, { "content-type": "application/x-www-form-urlencoded" });
        assert.ok(init?.body instanceof URLSearchParams);
        assert.deepEqual([...init.body.keys()].sort(), ["assertion", "grant_type"]);
        assert.equal(init.body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
        const parts = init.body.get("assertion")!.split("."); assert.equal(parts.length, 3);
        assert.deepEqual(JSON.parse(Buffer.from(parts[0], "base64url").toString()), { alg: "RS256", typ: "JWT" });
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        assert.ok(Number.isInteger(claims.iat)); assert.ok(Math.abs(claims.iat - Math.floor(Date.now() / 1000)) < 30);
        assert.deepEqual(claims, { iss: "synthetic-drive@example.invalid", scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly",
          aud: "https://oauth2.googleapis.com/token", iat: claims.iat, exp: claims.iat + 3600 });
        assert.equal(verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), this.publicKey, Buffer.from(parts[2], "base64url")), true);
      } else {
        assert.deepEqual(headers, { authorization: `Bearer ${TOKEN}` });
        if (this.forceMetadataViolation && requestURL.pathname.endsWith("/fixture-folder")) assert.equal(init?.method, "POST", "INJECTED_OPTIONS_ORACLE_FAILURE");
      }
    } catch {
      this.violations.push(`HTTP_CONTRACT:${this.attempts.length}`);
      throw new Error("HTTP_ORACLE_FAILED");
    }
    // Intentional source faults stay outside oracle validation and never count as violations.
    if (frame.reject) throw new Error(CANARY);
    return Response.json(frame.payload, { status: frame.status ?? 200 });
  }
  assertComplete() {
    assert.deepEqual(this.violations, [], "HTTP_ORACLE_VIOLATION");
    assert.equal(this.attempts.length, this.frames.length, "HTTP_ATTEMPT_COUNT");
    assert.ok(this.frames.every(frame => frame.used), "HTTP_SCRIPT_UNCONSUMED");
  }
}

export function expectation(scenario: Scenario) {
  const search = isSearch(scenario), found = scenario === "search" || scenario === "search_partial";
  const scanFailed = ["missing_config", "oauth_error", "metadata_error", "sheet_reject"].includes(scenario);
  const issues = scenario === "missing_config" ? CONFIG_ISSUES : scanFailed ? [SCAN_ISSUE] : scenario === "sheet_http_error" ? [BODY_ISSUE]
    : scenario === "search_http_error" ? [EMPTY_SEARCH] : scenario === "search_reject" ? [SEARCH_ISSUE] : [];
  const keyCandidates = search || scanFailed ? [] : [
    { confidence: "high", evidence: "", field: "driveLink", label: "Drive 폴더", sourceTitle: TITLE, value: FOLDER_URL },
    { confidence: "high", evidence: "", field: "lectureManagementLink", label: "강의관리 링크", sourceTitle: "강의관리 패들렛", value: SHEET_URL }
  ];
  const folderCandidates = found ? [{ confidence: "medium", reasons: ["기업명 일치", "과정명 토큰 1개 일치", "기간 월 정보 일치", "폴더명 기업 구간 일치"],
    score: 65, title: SEARCH_TITLE, url: "https://example.invalid/search-folder" }] : [];
  const candidateCount = search ? Number(found) : scanFailed ? 0 : scenario === "sheet_http_error" ? 3 : 4;
  const fileCount = search || scanFailed ? 0 : 1;
  const summary = { avgSatisfactionCandidates: 0, errors: 0, folderSearches: Number(search), folderSearchWithCandidates: Number(found),
    instructorCandidates: 0, instructorSatisfactionCandidates: 0, scanFoundFolder: Number(!search), scanIssues: Number(!search && issues.length > 0),
    scannedRefs: Number(!search), suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 0, zeroSatisfactionCandidates: 0 }, suspiciousCandidateCount: 0 };
  return { summary, issues, keyCandidates, folderCandidates, candidateCount, fileCount,
    inputKind: search ? "folderSearch" : "driveLink", inputValue: search ? "" : scenario === "reference" ? TITLE : LINK,
    resultKind: search ? found ? "folder_search_candidates" : "folder_search_empty" : "scan_found_folder",
    folderTitle: search || scanFailed ? "" : TITLE, folderUrl: search ? "" : scanFailed ? LINK : FOLDER_URL };
}
export function assertSource(scenario: Scenario, result: DriveImportScanResult | DriveFolderSearchResult) {
  const expected = expectation(scenario);
  assert.deepEqual(result.issues, expected.issues);
  assert.equal(result.candidates.length, expected.candidateCount);
  if (isSearch(scenario)) {
    assert.ok("searchedAt" in result); assert.ok(Number.isFinite(Date.parse(result.searchedAt)));
    assert.deepEqual(result.candidates, expected.folderCandidates.map(item => ({ ...item, folderId: "fixture-search-folder", companyMatched: true, ownerNames: [], modifiedTime: undefined })));
  } else {
    assert.ok("files" in result); assert.ok(Number.isFinite(Date.parse(result.scannedAt)));
    assert.equal(result.folderId, "fixture-folder"); assert.equal(result.folderTitle, expected.folderTitle); assert.equal(result.folderUrl, expected.folderUrl);
    assert.deepEqual(result.files, expected.fileCount ? [{ id: "fixture-sheet", title: "강의관리 패들렛", mimeType: "application/vnd.google-apps.spreadsheet", url: SHEET_URL, folderPath: TITLE, modifiedTime: undefined }] : []);
    // Candidate IDs are checked for shape/uniqueness and frozen/current equality; storage does not retain them.
    assert.equal(new Set(result.candidates.map(item => item.id)).size, result.candidates.length);
    const literals = expected.fileCount ? [
      { field: "driveLink", label: "Drive 폴더", value: FOLDER_URL, confidence: "high", sourceTitle: TITLE, sourceUrl: FOLDER_URL, sourceFileId: undefined, evidence: undefined, action: "replace", applyable: true },
      { field: "lectureManagementLink", label: "강의관리 링크", value: SHEET_URL, confidence: "high", sourceTitle: "강의관리 패들렛", sourceUrl: SHEET_URL, sourceFileId: "fixture-sheet", evidence: undefined, action: "replace", applyable: true },
      { field: "padletLink", label: "패들렛 링크", value: SHEET_URL, confidence: "medium", sourceTitle: "강의관리 패들렛", sourceUrl: SHEET_URL, sourceFileId: "fixture-sheet", evidence: undefined, action: "replace", applyable: true },
      ...(scenario === "sheet_http_error" ? [] : [{ field: "region", label: "교육장소", value: "FixtureRoom", confidence: "needs_review", sourceTitle: "강의관리 패들렛", sourceUrl: SHEET_URL, sourceFileId: "fixture-sheet", evidence: "FixtureRoom", action: "replace", applyable: true }])
    ] : [];
    assert.deepEqual(result.candidates.map(item => { assert.match(item.id, /^[A-Za-z]+:(?:folder|fixture-sheet):[a-z0-9]+$/); const { id, ...rest } = item; assert.ok(id); return rest; }), literals);
  }
}
export function withoutSourceTime(result: DriveImportScanResult | DriveFolderSearchResult) {
  return { ...result, ...("scannedAt" in result ? { scannedAt: "TIME" } : { searchedAt: "TIME" }) };
}
