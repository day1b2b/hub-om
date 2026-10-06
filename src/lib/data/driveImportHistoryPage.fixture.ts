/** Independent page-only semantic fixture. No application presenter/parser/sort imports.
 * PG/Mongo seed adapters may encode these values; expected DTO and UI are explicit.
 */
import assert from "node:assert/strict";

export const PAGE_RUN_ID = "51000000-0000-4000-8000-000000000001";
export const OLD_RUN_ID = "51000000-0000-4000-8000-000000000002";
export const EMPTY_RUN_ID = "51000000-0000-4000-8000-000000000003";
export const ACTOR = { user: { email: "synthetic-drive-page@day1company.co.kr", name: "Synthetic page operator" }, expires: "" };
export const MEMBERS = [
  { id: "52000000-0000-4000-8000-000000000001", role: null, sourceTeam: "TEAM_1", name: "가상페이지1팀", normalizedName: "가상페이지1팀", roleTitle: null, calendarId: null, isActive: true, displayOrder: 1, createdAt: new Date("2031-01-01T00:00:00Z"), updatedAt: new Date("2031-01-01T00:00:00Z") },
  { id: "52000000-0000-4000-8000-000000000002", role: null, sourceTeam: "TEAM_2", name: "가상페이지2팀", normalizedName: "가상페이지2팀", roleTitle: null, calendarId: null, isActive: true, displayOrder: 2, createdAt: new Date("2031-01-01T00:00:00Z"), updatedAt: new Date("2031-01-01T00:00:00Z") }
];
export const RUN_SEED = {
  id: PAGE_RUN_ID, mode: "dry_run", status: "PENDING", operationCount: 901, scannedRefCount: 102,
  scanFoundFolderCount: 103, scanIssueCount: 104, folderSearchCount: 105, folderSearchWithCandidatesCount: 106,
  avgSatisfactionCandidateCount: 107, instructorSatisfactionCandidateCount: 108, instructorCandidateCount: 109,
  suspiciousCandidateCount: 110, errorCount: 111, summary: { marker: "synthetic-not-returned-summary" },
  notes: "synthetic-not-returned-notes", startedAt: new Date("2031-01-02T03:04:05Z"), finishedAt: null
};
const keyCandidates = [
  { field: "instructors", value: "사내", sourceTitle: "Synthetic source", evidence: "Synthetic evidence" },
  { field: "avgSatisfaction", value: "4.7", confidence: "high", score: 9 },
  { field: "driveLink", value: "Synthetic key 3", url: "https://example.invalid/key/3" },
  { field: "instructorSatisfaction", value: "4.8" },
  { field: "lectureManagementLink", value: "Synthetic key 5" },
  { field: "resultReportLink", value: "Synthetic key 6" },
  { field: "instructors", value: "EXCLUDED_KEY_7" }
];
const folders = Array.from({ length: 5 }, (_, i) => ({ title: `Synthetic folder ${i + 1}`, url: `https://example.invalid/folder/${i + 1}`, score: i + 1 }));
export function resultSeed(index: number) {
  return {
    id: `53000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, runId: PAGE_RUN_ID, operationSessionId: null,
    operationId: `synthetic-page-${String(index).padStart(3, "0")}`, companyName: `Synthetic Company ${index % 2 ? "Team2" : "Team1"}`,
    courseName: `Synthetic Course ${String(index).padStart(3, "0")}`, startDate: index === 0 ? new Date("2031-01-03T00:00:00Z") : null,
    endDate: index === 0 ? new Date("2031-01-03T00:00:00Z") : index === 1 ? new Date("2031-01-04T00:00:00Z") : null,
    inputKind: index === 0 ? "driveLink" : index === 1 ? "folderSearch" : index === 2 ? "lectureManagementLink" : "synthetic_input",
    inputValue: index === 0 ? "Synthetic input & <value>" : null,
    resultKind: index === 0 ? "scan_found_folder" : index === 1 ? "folder_search_candidates" : index === 2 ? "error" : "scan_no_folder",
    folderId: "synthetic-not-returned-folder", folderTitle: index === 0 ? "Synthetic selected folder" : index === 2 ? "HIDDEN_BY_ERROR_FOLDER" : null,
    folderUrl: index === 0 ? "https://example.invalid/selected" : index === 2 ? "https://example.invalid/hidden-error-folder" : null,
    fileCount: index === 0 ? 17 : 0, candidateCount: 1000 - index,
    keyCandidates: index === 0 ? structuredClone(keyCandidates) : [],
    folderCandidates: index < 2 ? structuredClone(folders) : [],
    issues: index === 1 ? ["Synthetic issue 1", "Synthetic issue 2", "Synthetic issue 3", "EXCLUDED_ISSUE_4"] : index === 2 ? ["HIDDEN_BY_ERROR"] : [],
    error: index === 2 ? "Synthetic stored error" : null, createdAt: new Date("2031-01-02T04:00:00Z")
  };
}
export const RESULT_SEEDS = Array.from({ length: 251 }, (_, i) => resultSeed(i));
// Deliberately separate literals from seed projection: a changed seed does not silently update these fields.
export function expectedRow(index: number) {
  return {
    candidateCount: 1000 - index, companyName: `Synthetic Company ${index % 2 ? "Team2" : "Team1"}`,
    courseName: `Synthetic Course ${String(index).padStart(3, "0")}`, createdAt: "2031-01-02T04:00:00.000Z",
    endDate: index === 0 ? "2031-01-03" : index === 1 ? "2031-01-04" : "", error: index === 2 ? "Synthetic stored error" : "",
    fileCount: index === 0 ? 17 : 0, folderCandidates: index < 2 ? structuredClone(folders) : [],
    folderTitle: index === 0 ? "Synthetic selected folder" : index === 2 ? "HIDDEN_BY_ERROR_FOLDER" : "", folderUrl: index === 0 ? "https://example.invalid/selected" : index === 2 ? "https://example.invalid/hidden-error-folder" : "",
    inputKind: index === 0 ? "driveLink" : index === 1 ? "folderSearch" : index === 2 ? "lectureManagementLink" : "synthetic_input",
    inputValue: index === 0 ? "Synthetic input & <value>" : "",
    issues: index === 1 ? ["Synthetic issue 1", "Synthetic issue 2", "Synthetic issue 3", "EXCLUDED_ISSUE_4"] : index === 2 ? ["HIDDEN_BY_ERROR"] : [],
    keyCandidates: index === 0 ? structuredClone(keyCandidates) : [],
    operationId: `synthetic-page-${String(index).padStart(3, "0")}`,
    resultKind: index === 0 ? "scan_found_folder" : index === 1 ? "folder_search_candidates" : index === 2 ? "error" : "scan_no_folder",
    startDate: index === 0 ? "2031-01-03" : ""
  };
}
export function expectedView() {
  return {
    avgSatisfactionCandidateCount: 107, errorCount: 111, finishedAt: "", folderSearchCount: 105,
    folderSearchWithCandidatesCount: 106, id: PAGE_RUN_ID, instructorCandidateCount: 109,
    instructorSatisfactionCandidateCount: 108, mode: "dry_run", operationCount: 901,
    results: Array.from({ length: 250 }, (_, i) => expectedRow(i)), scanFoundFolderCount: 103,
    scanIssueCount: 104, scannedRefCount: 102, startedAt: "2031-01-02T03:04:05.000Z", status: "PENDING", suspiciousCandidateCount: 110
  };
}

function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/gi, (_, entity: string) => {
      const names: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (Object.hasOwn(names, entity)) return names[entity];
      return String.fromCodePoint(entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    });
}
function anchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(match => {
    const attribute = (name: string) => text(new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(match[1])?.[1] ?? "");
    return { href: attribute("href"), rel: attribute("rel"), target: attribute("target"), text: text(match[2]) };
  });
}
const link = (href: string, value: string, external = false) => ({ href, text: value, rel: external ? "noreferrer" : "", target: external ? "_blank" : "" });

/** Observe the actual React SSR output, never traverse/execute an expected presenter. */
export function assertPageMarkup(html: string, query: "" | "?team=team_1" | "?team=team_2") {
  const table = /<table\b[^>]*class="drive-import-run-table"[^>]*>([\s\S]*?)<\/table>/.exec(html); assert.ok(table);
  assert.deepEqual([...table[1].matchAll(/<th>([\s\S]*?)<\/th>/g)].map(match => text(match[1])), ["#", "운영", "입력", "조회 결과", "후보", "이슈"]);
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table[1]); assert.ok(body);
  const rows = [...body[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]; assert.equal(rows.length, 250);
  for (const [i, row] of rows.entries()) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => ({ text: text(match[1]), links: anchors(match[1]) }));
    const company = `Synthetic Company ${i % 2 ? "Team2" : "Team1"}`, course = `Synthetic Course ${String(i).padStart(3, "0")}`;
    const dates = i === 0 ? "2031-01-03" : i === 1 ? "시작일 없음 ~ 2031-01-04" : "일정 없음";
    const input = i === 0 ? "Drive 값Synthetic input & <value>" : i === 1 ? "폴더 검색검색어 자동 구성" : i === 2 ? "강의관리 링크검색어 자동 구성" : "synthetic_input검색어 자동 구성";
    const result = i === 0 ? "폴더 확인Synthetic selected folder17개 파일 · 1000개 후보" : i === 1 ? "폴더 후보999개 후보" : i === 2 ? "오류Synthetic stored error" : `폴더 미확인${1000 - i}개 후보`;
    const candidateText = i === 0
      ? "강사사내강사Synthetic sourceSynthetic evidence전체 만족도4.7신뢰도 high · 점수 9Drive 링크Synthetic key 3강사 만족도4.8강의관리Synthetic key 5결과보고서Synthetic key 6"
      : i === 1 ? "폴더Synthetic folder 1점수 1폴더Synthetic folder 2점수 2폴더Synthetic folder 3점수 3폴더Synthetic folder 4점수 4" : "후보 없음";
    const candidateLinks = i === 0 ? [link("https://example.invalid/key/3", "Synthetic key 3", true)]
      : i === 1 ? [1, 2, 3, 4].map(n => link(`https://example.invalid/folder/${n}`, `Synthetic folder ${n}`, true)) : [];
    assert.deepEqual(cells, [
      { text: String(i + 1), links: [] },
      { text: company + course + dates, links: [link(`/operations/synthetic-page-${String(i).padStart(3, "0")}${query}`, company + course)] },
      { text: input, links: [] },
      { text: result, links: i === 0 ? [link("https://example.invalid/selected", "Synthetic selected folder", true)] : [] },
      { text: candidateText, links: candidateLinks },
      { text: i === 1 ? "Synthetic issue 1Synthetic issue 2Synthetic issue 3" : i === 2 ? "Synthetic stored error" : "없음", links: [] }
    ], `full row ${i}`);
  }
  const metrics = [...html.matchAll(/<div class="metric-card"><span>([\s\S]*?)<\/span><strong>([\s\S]*?)<\/strong><small>([\s\S]*?)<\/small><\/div>/g)]
    .map(match => match.slice(1).map(text));
  assert.deepEqual(metrics, [
    ["대상 운영", "901", "PENDING"], ["링크/폴더 스캔", "102", "103건 폴더 확인"], ["폴더명 검색", "105", "106건 후보 있음"],
    ["전체 만족도 후보", "107", "전체/전반/종합/평균 근거만"], ["강사 만족도 후보", "108", "강사 만족도 근거"], ["오류", "111", "104건 이슈 기록"]
  ]);
  const plain = text(html);
  assert.ok(plain.includes("250건 표시 · run 51000000")); assert.ok(plain.includes("진행 기록"));
  assert.ok(plain.includes("2031. 1. 2. 오후 12:04"));
  for (const forbidden of ["synthetic-page-250", "EXCLUDED_KEY_7", "Synthetic folder 5", "EXCLUDED_ISSUE_4", "HIDDEN_BY_ERROR", "synthetic-not-returned-"]) assert.ok(!html.includes(forbidden), forbidden);
  // Team query is a navigation choice, not a new history filter.
  assert.ok(plain.includes("Synthetic Company Team1")); assert.ok(plain.includes("Synthetic Company Team2"));
}
export function assertEmptyMarkup(html: string, hasRun: boolean) {
  if (!hasRun) {
    assert.ok(html.includes("저장된 Drive 조회 결과가 없습니다."));
    assert.ok(html.includes("먼저 dry-run을 실행하면 이 화면에 결과가 표시됩니다."));
    assert.ok(!html.includes("drive-import-run-table")); assert.ok(!html.includes("metric-card"));
  } else {
    assert.ok(html.includes("0건 표시")); assert.ok(html.includes("drive-import-run-table"));
    assert.ok(!html.includes("Synthetic Course")); assert.ok(!html.includes("저장된 Drive 조회 결과가 없습니다."));
  }
}
