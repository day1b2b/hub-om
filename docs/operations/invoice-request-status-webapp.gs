/**
 * hub-om "계산서 발행 요청 현황"용 Apps Script 웹앱.
 *
 * 계산서 발급 신청 응답 시트는 회사 도메인 안에서만 공유돼 있어 hub-om 서버 계정으로는 못 읽는다.
 * 시트를 읽을 수 있는 회사 계정으로 이 스크립트를 배포하면, 서버는 이 웹앱에서 필요한 다섯 열만 받아 간다.
 * 사업자번호·금액 같은 나머지 열은 웹앱 밖으로 나가지 않는다.
 *
 * 설정(시트 ID·토큰은 코드에 적지 않는다 — 이 파일은 public 저장소에 있다):
 *   프로젝트 설정 > 스크립트 속성
 *     SHEET_ID  응답 시트 ID
 *     SHEET_TAB 탭 이름(비우면 "설문지 응답 시트(전사_공통)")
 *     TOKEN     긴 임의 문자열. hub-om Coolify의 INVOICE_REQUEST_STATUS_TOKEN과 같은 값
 *   배포 > 새 배포 > 웹 앱: 실행 사용자 "나", 액세스 권한 "모든 사용자"
 *     → 웹 앱 URL을 Coolify INVOICE_REQUEST_STATUS_URL에 넣는다.
 *
 * 스크립트 편집 권한은 다른 사람에게 공유하지 않는다(배포 계정 권한으로 실행되기 때문).
 *
 * 응답: { ok: true, rows: [[타임스탬프, 코스ID, 발급여부, 발급일자, 실제입금일자], ...] } (헤더 제외, 시트 표시값)
 *       실패는 { ok: false, error: "unauthorized" | "not_configured" | "unexpected_header" | "read_failed" }
 */

var DEFAULT_TAB = "설문지 응답 시트(전사_공통)";
var COLUMN_PREFIXES = ["타임스탬프", "코스ID", "발급여부", "발급일자", "실제입금일자"];
var REQUIRED_COLUMNS = 2; // 타임스탬프·코스ID는 꼭 있어야 하고, 처리 결과 열은 없으면 빈 값.

function doPost(e) {
  var token = "";
  try {
    token = String(JSON.parse(e.postData.contents).token || "");
  } catch (err) {
    return json_({ ok: false, error: "unauthorized" });
  }
  return json_(readStatusRows_(token));
}

function readStatusRows_(token) {
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty("TOKEN") || "";
  if (!expected || token !== expected) return { ok: false, error: "unauthorized" };

  var sheetId = props.getProperty("SHEET_ID") || "";
  if (!sheetId) return { ok: false, error: "not_configured" };

  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName(props.getProperty("SHEET_TAB") || DEFAULT_TAB);
    if (!sheet) return { ok: false, error: "not_configured" };

    var lastColumn = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();
    var header = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
    var indexes = COLUMN_PREFIXES.map(function (prefix) {
      for (var i = 0; i < header.length; i++) {
        if (String(header[i]).replace(/\s+/g, "").indexOf(prefix) === 0) return i;
      }
      return -1;
    });
    for (var r = 0; r < REQUIRED_COLUMNS; r++) {
      if (indexes[r] < 0) return { ok: false, error: "unexpected_header" };
    }
    if (lastRow < 2) return { ok: true, rows: [] };

    // 시트 전체가 아니라 필요한 열만 하나씩 읽는다.
    var columns = indexes.map(function (index) {
      return index < 0 ? null : sheet.getRange(2, index + 1, lastRow - 1, 1).getDisplayValues();
    });
    var rows = [];
    for (var row = 0; row < lastRow - 1; row++) {
      rows.push(columns.map(function (column) {
        return column ? String(column[row][0]) : "";
      }));
    }
    return { ok: true, rows: rows };
  } catch (err) {
    return { ok: false, error: "read_failed" };
  }
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/** 배포 전 편집기에서 실행해 보는 용도. 실행 로그에 행 수만 찍는다. */
function testRead() {
  var result = readStatusRows_(PropertiesService.getScriptProperties().getProperty("TOKEN") || "");
  Logger.log(result.ok ? "ok, rows: " + result.rows.length : "error: " + result.error);
}
