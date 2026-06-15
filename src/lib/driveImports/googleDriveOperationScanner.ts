import { createSign } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type {
  DriveImportCandidate,
  DriveImportCandidateField,
  DriveImportFileSummary,
  DriveFolderSearchCandidate,
  DriveFolderSearchResult,
  DriveImportScanResult
} from "./driveImportTypes";
import type { OperationSession } from "@/lib/data/operationTypes";
import { summarizeSatisfactionValue } from "@/lib/data/satisfaction";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_RECURSION_DEPTH = 2;
const MAX_TEXT_FILES = 10;
const MAX_FOLDER_SEARCH_RESULTS = 25;
const MAX_EXTRACTED_TEXT_LENGTH = 80_000;
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_PRESENTATION_MIME_TYPE = "application/vnd.google-apps.presentation";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DRIVE_OWNER_KOREAN_NAMES: Record<string, string> = {
  hayoungjung: "정하영",
  minsunkim: "김민선",
  saebomkong: "공새봄",
  seongminyun: "윤성민",
  seungminha: "하승민",
  yeokyeongjo: "조여경",
  yeokyoungjo: "조여경",
  yookyungjo: "조여경"
};

interface GoogleDriveConfig {
  serviceAccountEmail: string;
  privateKey: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  owners?: Array<{
    displayName?: string;
    emailAddress?: string;
  }>;
}

interface GoogleDriveListResponse {
  files?: GoogleDriveFile[];
  error?: {
    message?: string;
  };
}

interface GoogleSheetResponse {
  sheets?: Array<{
    properties?: {
      title?: string;
    };
    data?: Array<{
      rowData?: Array<{
        values?: Array<{
          formattedValue?: string;
        }>;
      }>;
    }>;
  }>;
  error?: {
    message?: string;
  };
}

interface ScannedDriveFile extends DriveImportFileSummary {
  text?: string;
}

interface SatisfactionSummary {
  average: string;
  instructor: string;
  evidence: string;
  note: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function searchOperationDriveFolders(operation: OperationSession): Promise<DriveFolderSearchResult> {
  const searchedAt = new Date().toISOString();
  const config = readGoogleDriveConfig();
  const issues = validateGoogleDriveConfig(config);

  if (issues.length > 0) {
    return {
      candidates: [],
      issues,
      searchedAt
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(config);
    const folders = await searchDriveFolders(operation, accessToken);
    const candidates = scoreDriveFolderCandidates(folders, operation);

    return {
      candidates,
      issues: candidates.length > 0 ? [] : ["과정명/기업명 기준으로 Drive 폴더 후보를 찾지 못했습니다."],
      searchedAt
    };
  } catch {
    return {
      candidates: [],
      issues: ["Google Drive 폴더 검색에 실패했습니다. 서비스 계정 권한과 공유 범위를 확인해야 합니다."],
      searchedAt
    };
  }
}

export async function scanOperationDriveFolder(folderUrl: string): Promise<DriveImportScanResult> {
  const folderId = extractDriveFolderId(folderUrl);
  const scannedAt = new Date().toISOString();

  if (!folderId) {
    return {
      folderId: "",
      folderTitle: "",
      folderUrl,
      scannedAt,
      candidates: [],
      files: [],
      issues: ["Drive folder URL을 확인할 수 없습니다."]
    };
  }

  const config = readGoogleDriveConfig();
  const issues = validateGoogleDriveConfig(config);

  if (issues.length > 0) {
    return {
      folderId,
      folderTitle: "",
      folderUrl,
      scannedAt,
      candidates: [],
      files: [],
      issues
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(config);
    const folder = await getDriveFile(folderId, accessToken);
    const files = await listDriveTree(folderId, folder.name, accessToken);
    const textFiles = await readPriorityTextFiles(files, accessToken);
    const candidates = buildCandidates(folder, folderUrl, files, textFiles);

    return {
      folderId,
      folderTitle: folder.name,
      folderUrl: folder.webViewLink ?? folderUrl,
      scannedAt,
      candidates,
      files,
      issues: textFiles.some((file) => file.text) ? [] : ["본문까지 읽힌 싱크업 문서가 없어 파일명/폴더명 중심 후보만 생성했습니다."]
    };
  } catch {
    return {
      folderId,
      folderTitle: "",
      folderUrl,
      scannedAt,
      candidates: [],
      files: [],
      issues: ["Google Drive 폴더를 읽지 못했습니다. 서비스 계정 공유 권한과 환경변수를 확인해야 합니다."]
    };
  }
}

export function extractDriveFolderId(value: string): string | null {
  const trimmed = value.trim();
  const folderMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (folderMatch) return folderMatch[1];

  const idParamMatch = /[?&]id=([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (idParamMatch) return idParamMatch[1];

  return /^[a-zA-Z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
}

function readGoogleDriveConfig(): GoogleDriveConfig {
  return {
    serviceAccountEmail:
      process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim() ||
      process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL?.trim() ||
      "",
    privateKey: normalizePrivateKey(
      process.env.GOOGLE_DRIVE_PRIVATE_KEY || process.env.GOOGLE_CALENDAR_PRIVATE_KEY || ""
    )
  };
}

function validateGoogleDriveConfig(config: GoogleDriveConfig): string[] {
  const issues: string[] = [];

  if (!config.serviceAccountEmail) {
    issues.push("GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL 또는 GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL 설정이 필요합니다.");
  }

  if (!config.privateKey) {
    issues.push("GOOGLE_DRIVE_PRIVATE_KEY 또는 GOOGLE_CALENDAR_PRIVATE_KEY 설정이 필요합니다.");
  }

  return issues;
}

async function getGoogleAccessToken(config: GoogleDriveConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const assertion = buildJwtAssertion(config, now);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error ?? "google_token_request_failed");
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600)
  };

  return payload.access_token;
}

function buildJwtAssertion(config: GoogleDriveConfig, now: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: config.serviceAccountEmail,
      scope: GOOGLE_DRIVE_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now
    })
  );
  const signatureInput = `${header}.${claimSet}`;
  const signature = createSign("RSA-SHA256").update(signatureInput).sign(config.privateKey);

  return `${signatureInput}.${base64UrlEncode(signature)}`;
}

async function getDriveFile(fileId: string, accessToken: string): Promise<GoogleDriveFile> {
  const url = new URL(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,webViewLink,modifiedTime");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GoogleDriveFile & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "google_drive_file_read_failed");
  }

  return payload;
}

async function listDriveTree(folderId: string, folderTitle: string, accessToken: string): Promise<ScannedDriveFile[]> {
  const files: ScannedDriveFile[] = [];

  await visitFolder(folderId, folderTitle, 0);
  return files;

  async function visitFolder(currentFolderId: string, folderPath: string, depth: number) {
    const children = await listDriveFolder(currentFolderId, accessToken);

    for (const child of children) {
      const summary: ScannedDriveFile = {
        id: child.id,
        title: child.name,
        mimeType: child.mimeType,
        url: child.webViewLink,
        folderPath,
        modifiedTime: child.modifiedTime
      };

      files.push(summary);

      if (child.mimeType === FOLDER_MIME_TYPE && depth < MAX_RECURSION_DEPTH) {
        await visitFolder(child.id, `${folderPath} / ${child.name}`, depth + 1);
      }
    }
  }
}

async function listDriveFolder(folderId: string, accessToken: string): Promise<GoogleDriveFile[]> {
  const url = new URL(GOOGLE_DRIVE_FILES_URL);
  url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
  url.searchParams.set("fields", "files(id,name,mimeType,webViewLink,modifiedTime)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GoogleDriveListResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "google_drive_folder_read_failed");
  }

  return payload.files ?? [];
}

async function searchDriveFolders(operation: OperationSession, accessToken: string): Promise<GoogleDriveFile[]> {
  const queries = buildFolderSearchQueries(operation);
  const results = await Promise.all(queries.map((query) => searchDriveFoldersByQuery(query, accessToken)));
  const foldersById = new Map<string, GoogleDriveFile>();

  for (const folder of results.flat()) {
    foldersById.set(folder.id, folder);
  }

  return [...foldersById.values()];
}

async function searchDriveFoldersByQuery(query: string, accessToken: string): Promise<GoogleDriveFile[]> {
  const url = new URL(GOOGLE_DRIVE_FILES_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName,emailAddress))");
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("corpora", "allDrives");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GoogleDriveListResponse;

  if (!response.ok) {
    return [];
  }

  return payload.files ?? [];
}

function buildFolderSearchQueries(operation: OperationSession): string[] {
  const companyName = cleanupDriveSearchTerm(operation.companyName);
  const courseTokens = tokenizeDriveSearchText(operation.courseName).slice(0, 4);
  const monthTokens = buildOperationMonthTokens(operation);
  const terms = [
    companyName,
    ...courseTokens,
    ...monthTokens
  ].filter(Boolean);
  const uniqueTerms = [...new Set(terms)].slice(0, 8);
  const base = [`mimeType = '${FOLDER_MIME_TYPE}'`, "trashed = false"];
  const queries: string[] = [];

  if (companyName) {
    queries.push([...base, `name contains '${escapeDriveQueryValue(companyName)}'`].join(" and "));
  }

  for (const token of courseTokens.slice(0, 3)) {
    queries.push([...base, `name contains '${escapeDriveQueryValue(token)}'`].join(" and "));
  }

  for (const token of monthTokens) {
    queries.push([...base, `name contains '${escapeDriveQueryValue(token)}'`].join(" and "));
  }

  if (uniqueTerms.length > 0) {
    const anyTermQuery = uniqueTerms
      .map((term) => `name contains '${escapeDriveQueryValue(term)}'`)
      .join(" or ");
    queries.push([...base, `(${anyTermQuery})`].join(" and "));
  }

  return [...new Set(queries)];
}

function scoreDriveFolderCandidates(folders: GoogleDriveFile[], operation: OperationSession): DriveFolderSearchCandidate[] {
  return folders
    .map((folder) => scoreDriveFolderCandidate(folder, operation))
    .filter((candidate) => candidate.score >= 20)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ko-KR"))
    .slice(0, MAX_FOLDER_SEARCH_RESULTS);
}

function scoreDriveFolderCandidate(folder: GoogleDriveFile, operation: OperationSession): DriveFolderSearchCandidate {
  const normalizedTitle = normalize(folder.name);
  const companyName = cleanupDriveSearchTerm(operation.companyName);
  const courseTokens = tokenizeDriveSearchText(operation.courseName);
  const monthTokens = buildOperationMonthTokens(operation);
  const ownerNames = (folder.owners ?? [])
    .map(formatDriveOwnerName)
    .filter(Boolean);
  const assigneeNames = [operation.om, operation.ld]
    .flatMap((value) => value.split(/[,/]/).map((name) => name.trim()))
    .filter(Boolean);
  const companyMatched = companyName ? driveFolderMatchesCompany(folder.name, companyName) : true;
  const reasons: string[] = [];
  let score = 0;

  if (companyName && companyMatched) {
    score += 35;
    reasons.push("기업명 일치");
  } else if (companyName) {
    score -= 10;
    reasons.push("기업명 불일치");
  }

  const matchedCourseTokens = courseTokens.filter((token) => normalizedTitle.includes(normalize(token)));
  if (matchedCourseTokens.length > 0) {
    score += Math.min(35, matchedCourseTokens.length * 10);
    reasons.push(`과정명 토큰 ${matchedCourseTokens.length}개 일치`);
  }

  const matchedMonthTokens = monthTokens.filter((token) => normalizedTitle.includes(normalize(token)));
  if (matchedMonthTokens.length > 0) {
    score += Math.min(20, matchedMonthTokens.length * 10);
    reasons.push("기간 월 정보 일치");
  }

  const folderParts = parseOperationFolderName(folder.name);
  if (folderParts.companyName && companyName && normalize(folderParts.companyName) === normalize(companyName)) {
    score += 10;
    reasons.push("폴더명 기업 구간 일치");
  }

  const matchedOwner = assigneeNames.find((name) =>
    ownerNames.some((ownerName) => normalizePersonLikeText(ownerName).includes(normalizePersonLikeText(name)))
  );
  if (matchedOwner) {
    score += 12;
    reasons.push(`소유자 담당자 일치: ${matchedOwner}`);
  }

  if (isTemplateFile(folder.name)) {
    score -= 80;
    reasons.push("템플릿 폴더 제외 대상");
  }

  const confidence: DriveFolderSearchCandidate["confidence"] = score >= 75 ? "high" : score >= 45 ? "medium" : "needs_review";

  return {
    companyMatched,
    confidence,
    folderId: folder.id,
    modifiedTime: folder.modifiedTime,
    ownerNames: uniqueStrings(ownerNames.map((owner) => owner.trim()).filter(Boolean)).slice(0, 3),
    reasons,
    score,
    title: folder.name,
    url: folder.webViewLink
  };
}

async function readPriorityTextFiles(files: ScannedDriveFile[], accessToken: string): Promise<ScannedDriveFile[]> {
  const priorityFiles = files
    .filter((file) => file.mimeType !== FOLDER_MIME_TYPE && !isTemplateFile(file.title))
    .sort(compareTextReadPriority)
    .slice(0, MAX_TEXT_FILES);

  return Promise.all(
    priorityFiles.map(async (file) => ({
      ...file,
      text: await readFileText(file, accessToken)
    }))
  );
}

async function readFileText(file: ScannedDriveFile, accessToken: string): Promise<string> {
  if (file.mimeType === XLSX_MIME_TYPE) {
    return readXlsxFileText(file.id, accessToken);
  }

  if (file.mimeType === GOOGLE_SHEET_MIME_TYPE) {
    return readSpreadsheetText(file.id, accessToken);
  }

  if (file.mimeType === GOOGLE_DOC_MIME_TYPE) {
    return exportDriveFileText(file.id, "text/plain", accessToken);
  }

  if (file.mimeType === GOOGLE_PRESENTATION_MIME_TYPE) {
    return exportDriveFileText(file.id, "text/plain", accessToken);
  }

  return "";
}

async function readSpreadsheetText(fileId: string, accessToken: string): Promise<string> {
  const url = new URL(`${GOOGLE_SHEETS_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("includeGridData", "true");
  url.searchParams.set("fields", "sheets(properties(title),data(rowData(values(formattedValue))))");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GoogleSheetResponse;

  if (!response.ok) {
    return "";
  }

  return (payload.sheets ?? [])
    .map((sheet) => {
      const title = sheet.properties?.title ? `# ${sheet.properties.title}` : "";
      const rows = (sheet.data ?? [])
        .flatMap((data) => data.rowData ?? [])
        .map((row) => trimTrailingEmptyCells((row.values ?? []).map((cell) => cell.formattedValue?.trim() ?? "")))
        .filter((row) => row.some(Boolean))
        .map((row) => row.join(" | "));

      return [title, ...rows].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

async function exportDriveFileText(fileId: string, mimeType: string, accessToken: string): Promise<string> {
  const url = new URL(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export`);
  url.searchParams.set("mimeType", mimeType);

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return "";
  }

  return response.text();
}

async function readXlsxFileText(fileId: string, accessToken: string): Promise<string> {
  const url = new URL(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return "";
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return parseXlsxBufferText(buffer).slice(0, MAX_EXTRACTED_TEXT_LENGTH);
}

function parseXlsxBufferText(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const workbookXml = entries.get("xl/workbook.xml");
  const workbookRelsXml = entries.get("xl/_rels/workbook.xml.rels");

  if (!workbookXml || !workbookRelsXml) {
    return "";
  }

  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") ?? "");
  const relationships = parseWorkbookRelationships(workbookRelsXml);
  const sheets = parseWorkbookSheets(workbookXml, relationships);

  return sheets
    .map((sheet) => {
      const sheetXml = entries.get(sheet.path);
      if (!sheetXml) return "";

      const rows = parseWorksheetRows(sheetXml, sharedStrings)
        .filter((row) => row.length > 0)
        .map((row) => row.join(" | "));

      if (rows.length === 0) return "";
      return [`# ${sheet.name}`, ...rows].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function readZipEntries(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  const eocdOffset = findEndOfCentralDirectory(buffer);

  if (eocdOffset < 0) {
    return entries;
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength).replace(/^\/+/, "");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    try {
      if (method === 0) {
        entries.set(fileName, compressed.toString("utf8"));
      } else if (method === 8) {
        entries.set(fileName, inflateRawSync(compressed).toString("utf8"));
      }
    } catch {
      // Skip individual damaged or unsupported entries; other sheets can still be useful.
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65_557);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
}

function parseSharedStrings(xml: string): string[] {
  return Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map((match) => {
    const textParts = Array.from(match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((textMatch) =>
      decodeXml(textMatch[1] ?? "")
    );

    return textParts.join("");
  });
}

function parseWorkbookRelationships(xml: string): Map<string, string> {
  const relationships = new Map<string, string>();

  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = getXmlAttribute(tag, "Id");
    const target = getXmlAttribute(tag, "Target");
    if (!id || !target) continue;

    relationships.set(id, resolveXlsxPath("xl", target));
  }

  return relationships;
}

function parseWorkbookSheets(workbookXml: string, relationships: Map<string, string>): Array<{ name: string; path: string }> {
  const sheets: Array<{ name: string; path: string }> = [];

  for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = getXmlAttribute(tag, "name");
    const relationshipId = getXmlAttribute(tag, "r:id") || getXmlAttribute(tag, "id");
    const path = relationshipId ? relationships.get(relationshipId) : undefined;

    if (name && path) {
      sheets.push({ name, path });
    }
  }

  return sheets;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  return Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
    const rowXml = rowMatch[1] ?? "";
    const row: string[] = [];

    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? "";
      const cellReference = getXmlAttribute(attributes, "r");
      const cellIndex = cellReference ? columnReferenceToIndex(cellReference) : row.length;
      row[cellIndex] = parseCellValue(attributes, cellMatch[2] ?? "", sharedStrings).trim();
    }

    return trimTrailingEmptyCells(row.map((cell) => cell ?? ""));
  });
}

function parseCellValue(attributes: string, cellXml: string, sharedStrings: string[]): string {
  const type = getXmlAttribute(attributes, "t");

  if (type === "inlineStr") {
    return Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((match) => decodeXml(match[1] ?? ""))
      .join("");
  }

  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? "";

  if (type === "s") {
    const index = Number(value);
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }

  return decodeXml(value);
}

function resolveXlsxPath(basePath: string, target: string): string {
  const rawPath = target.startsWith("/") ? target.slice(1) : `${basePath}/${target}`;
  const parts: string[] = [];

  for (const part of rawPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join("/");
}

function getXmlAttribute(tag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`, "u").exec(tag);
  return match ? decodeXml(match[1] ?? "") : "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function columnReferenceToIndex(reference: string): number {
  const column = /^[A-Z]+/i.exec(reference)?.[0] ?? "";
  let index = 0;

  for (const character of column.toUpperCase()) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

function trimTrailingEmptyCells(cells: string[]): string[] {
  const nextCells = [...cells];

  while (nextCells.length > 0 && !nextCells[nextCells.length - 1]) {
    nextCells.pop();
  }

  return nextCells;
}

function buildCandidates(
  folder: GoogleDriveFile,
  folderUrl: string,
  files: ScannedDriveFile[],
  textFiles: ScannedDriveFile[]
): DriveImportCandidate[] {
  const candidates: DriveImportCandidate[] = [];
  const folderParts = parseOperationFolderName(folder.name);

  candidates.push(
    buildCandidate({
      field: "driveLink",
      label: "Drive 폴더",
      value: folder.webViewLink ?? folderUrl,
      sourceTitle: folder.name,
      sourceUrl: folder.webViewLink ?? folderUrl,
      confidence: "high"
    })
  );

  if (folderParts.companyName) {
    candidates.push(
      buildCandidate({
        field: "companyName",
        label: "기업명",
        value: folderParts.companyName,
        sourceTitle: folder.name,
        sourceUrl: folder.webViewLink ?? folderUrl,
        confidence: "medium",
        applyable: false
      })
    );
  }

  if (folderParts.courseName) {
    candidates.push(
      buildCandidate({
        field: "courseName",
        label: "과정명",
        value: folderParts.courseName,
        sourceTitle: folder.name,
        sourceUrl: folder.webViewLink ?? folderUrl,
        confidence: "medium",
        applyable: false
      })
    );
  }

  addFileLinkCandidates(candidates, files);
  addTextCandidates(candidates, textFiles);

  return dedupeCandidates(candidates);
}

function addFileLinkCandidates(candidates: DriveImportCandidate[], files: ScannedDriveFile[]) {
  for (const file of files) {
    if (!file.url || file.mimeType === FOLDER_MIME_TYPE || isTemplateFile(file.title)) continue;

    const normalizedTitle = normalize(file.title);
    const normalizedPath = normalize(file.folderPath);
    const source = {
      sourceFileId: file.id,
      sourceTitle: file.title,
      sourceUrl: file.url
    };

    if (isSyncupLikeTitle(normalizedTitle)) {
      candidates.push(
        buildCandidate({
          field: "operationDetail",
          label: "싱크업 문서",
          value: file.url,
          confidence: "high",
          ...source
        })
      );
    }

    if (normalizedTitle.includes("강의관리")) {
      candidates.push(
        buildCandidate({
          field: "lectureManagementLink",
          label: "강의관리 링크",
          value: file.url,
          confidence: "high",
          ...source
        })
      );
    }

    if (normalizedTitle.includes("결과보고") || normalizedPath.includes("결과보고")) {
      candidates.push(
        buildCandidate({
          field: "resultReportLink",
          label: "결과보고서 링크",
          value: file.url,
          confidence: "medium",
          ...source
        })
      );
    }

    if (normalizedTitle.includes("padlet") || normalizedTitle.includes("패들렛")) {
      candidates.push(
        buildCandidate({
          field: "padletLink",
          label: "패들렛 링크",
          value: file.url,
          confidence: "medium",
          ...source
        })
      );
    }

    const instructorName = extractInstructorNameFromTitle(file.title);
    if (instructorName) {
      candidates.push(
        buildCandidate({
          field: "instructors",
          label: "강사",
          value: instructorName,
          confidence: "medium",
          evidence: file.title,
          ...source
        })
      );
    }
  }
}

function addTextCandidates(candidates: DriveImportCandidate[], textFiles: ScannedDriveFile[]) {
  for (const file of textFiles) {
    if (!file.text) continue;

    const source = {
      sourceFileId: file.id,
      sourceTitle: file.title,
      sourceUrl: file.url
    };
    const text = file.text;
    const rows = text.split(/\n+/).map((row) => row.trim()).filter(Boolean);
    const courseName = findLabeledValue(rows, "과정명");
    const place = findLabeledValue(rows, "교육장소");
    const hour = findLabeledValue(rows, "총 교육시수");
    const schedule = findLabeledValue(rows, "교육일정");
    const instructor = extractInstructorName(text);
    const instructorCost = extractInstructorCost(text);
    const operationCost = extractOperationCost(text);
    const totalCost = extractTotalCost(text);
    const satisfaction = extractSatisfactionScores(text);
    const timeText = extractTimeText(text);
    const actionItems = extractActionItems(rows);
    const operationNotes = extractOperationNotes(rows);

    if (courseName) {
      candidates.push(
        buildCandidate({
          field: "courseName",
          label: "과정명",
          value: courseName,
          confidence: "high",
          evidence: truncateEvidence(courseName),
          applyable: false,
          ...source
        })
      );
    }

    if (place) {
      candidates.push(
        buildCandidate({
          field: "region",
          label: "교육장소",
          value: place,
          confidence: "needs_review",
          evidence: truncateEvidence(place),
          ...source
        })
      );
    }

    if (hour) {
      candidates.push(
        buildCandidate({
          field: "educationDays",
          label: "교육시수",
          value: hour,
          confidence: "medium",
          evidence: truncateEvidence(hour),
          ...source
        })
      );
    }

    if (schedule) {
      candidates.push(
        buildCandidate({
          field: "specialNotes",
          label: "교육일정 메모",
          value: schedule,
          action: "append",
          confidence: "needs_review",
          evidence: truncateEvidence(schedule),
          ...source
        })
      );
    }

    if (instructor) {
      candidates.push(
        buildCandidate({
          field: "instructors",
          label: "강사",
          value: instructor,
          confidence: "medium",
          evidence: instructor,
          ...source
        })
      );
    }

    if (instructorCost !== null) {
      candidates.push(
        buildCandidate({
          field: "instructorCost",
          label: "강사비",
          value: String(instructorCost),
          confidence: "needs_review",
          evidence: String(instructorCost),
          ...source
        })
      );
    }

    if (operationCost !== null) {
      candidates.push(
        buildCandidate({
          field: "operationCost",
          label: "운영비",
          value: String(operationCost),
          confidence: "needs_review",
          evidence: String(operationCost),
          ...source
        })
      );
    }

    if (totalCost !== null) {
      candidates.push(
        buildCandidate({
          field: "totalCost",
          label: "총 비용",
          value: String(totalCost),
          confidence: "needs_review",
          evidence: String(totalCost),
          ...source
        })
      );
    }

    if (satisfaction.average) {
      candidates.push(
        buildCandidate({
          field: "avgSatisfaction",
          label: "전체 만족도",
          value: satisfaction.average,
          confidence: "medium",
          evidence: satisfaction.evidence,
          ...source
        })
      );
    }

    if (satisfaction.note) {
      candidates.push(
        buildCandidate({
          field: "specialNotes",
          label: "만족도 메모",
          value: satisfaction.note,
          action: "append",
          confidence: "needs_review",
          evidence: satisfaction.evidence,
          ...source
        })
      );
    }

    if (satisfaction.instructor) {
      candidates.push(
        buildCandidate({
          field: "instructorSatisfaction",
          label: "강사 만족도",
          value: satisfaction.instructor,
          confidence: "medium",
          evidence: satisfaction.evidence,
          ...source
        })
      );
    }

    if (timeText) {
      candidates.push(
        buildCandidate({
          field: "timeText",
          label: "교육시간",
          value: timeText,
          confidence: "needs_review",
          evidence: timeText,
          ...source
        })
      );
    }

    if (actionItems) {
      candidates.push(
        buildCandidate({
          field: "operationIssue",
          label: "액션아이템",
          value: actionItems,
          action: "append",
          confidence: "needs_review",
          evidence: truncateEvidence(actionItems),
          ...source
        })
      );
    }

    if (operationNotes.issue) {
      candidates.push(
        buildCandidate({
          field: "operationIssue",
          label: "운영 특이사항",
          value: operationNotes.issue,
          action: "append",
          confidence: "needs_review",
          evidence: truncateEvidence(operationNotes.issue),
          ...source
        })
      );
    }

    if (operationNotes.omUpdate) {
      candidates.push(
        buildCandidate({
          field: "omUpdate",
          label: "OM 업데이트",
          value: operationNotes.omUpdate,
          action: "append",
          confidence: "needs_review",
          evidence: truncateEvidence(operationNotes.omUpdate),
          ...source
        })
      );
    }

    if (operationNotes.summary) {
      candidates.push(
        buildCandidate({
          field: "specialNotes",
          label: "강의 운영 요약",
          value: operationNotes.summary,
          action: "append",
          confidence: "needs_review",
          evidence: truncateEvidence(operationNotes.summary),
          ...source
        })
      );
    }
  }
}

function buildCandidate(input: {
  field: DriveImportCandidateField;
  label: string;
  value: string;
  action?: DriveImportCandidate["action"];
  confidence: DriveImportCandidate["confidence"];
  sourceFileId?: string;
  sourceTitle: string;
  sourceUrl?: string;
  evidence?: string;
  applyable?: boolean;
}): DriveImportCandidate {
  return {
    id: `${input.field}:${input.sourceFileId ?? "folder"}:${hashCandidateValue(input.value)}`,
    field: input.field,
    label: input.label,
    value: input.value,
    action: input.action ?? "replace",
    confidence: input.confidence,
    sourceFileId: input.sourceFileId,
    sourceTitle: input.sourceTitle,
    sourceUrl: input.sourceUrl,
    evidence: input.evidence,
    applyable: input.applyable ?? true
  };
}

function parseOperationFolderName(value: string): { companyName?: string; courseName?: string } {
  const parts = value.split("_").map((part) => part.trim()).filter(Boolean);

  if (parts.length < 3) {
    return {};
  }

  return {
    companyName: parts[1],
    courseName: parts.slice(2).join("_")
  };
}

function findLabeledValue(rows: string[], label: string): string {
  for (const row of rows) {
    const parts = row.split("|").map((part) => part.trim()).filter(Boolean);
    const labelIndex = parts.findIndex((part) => part === label || part.replace(/\s+/g, "").includes(label));

    if (labelIndex >= 0) {
      const value = parts.slice(labelIndex + 1).find((part) => !part.includes("False") && part !== label);
      if (value) return value;
    }
  }

  return "";
}

function extractInstructorName(value: string): string {
  const titleMatch = extractInstructorNameFromTitle(value);
  if (titleMatch) return titleMatch;

  const textMatch = /강사(?:님|명|[:\s]){0,3}\s*([가-힣]{2,5})/.exec(value);
  return textMatch?.[1] ?? "";
}

function extractInstructorNameFromTitle(value: string): string {
  const spacedMatch = /([가-힣]{2,5})\s*강사/.exec(value);
  if (spacedMatch) return spacedMatch[1];

  const parenthesisMatch = /\(([가-힣]{2,5})강사\)/.exec(value);
  return parenthesisMatch?.[1] ?? "";
}

function extractInstructorCost(value: string): number | null {
  const costLines = value
    .split(/\n+/)
    .filter((line) => line.includes("강사료"))
    .map((line) => line.replaceAll(",", ""));
  const costs = costLines
    .flatMap((line) => Array.from(line.matchAll(/\b\d{5,9}\b/g)).map((match) => Number(match[0])))
    .filter((cost) => Number.isFinite(cost) && cost > 0);

  if (costs.length === 0) return null;

  return Math.max(...costs);
}

function extractOperationCost(value: string): number | null {
  return extractLargestMoneyFromMatchingLines(value, ["운영비", "운영조교", "실습코치", "총급여"], ["강사료"]);
}

function extractTotalCost(value: string): number | null {
  return extractLargestMoneyFromMatchingLines(value, ["총비용", "총견적", "견적합계", "총금액", "합계"], ["강사료", "운영비"]);
}

function extractLargestMoneyFromMatchingLines(value: string, keywords: string[], excludedKeywords: string[] = []): number | null {
  const normalizedKeywords = keywords.map(normalize);
  const normalizedExcludedKeywords = excludedKeywords.map(normalize);
  const costs = value
    .split(/\n+/)
    .filter((line) => {
      const normalizedLine = normalize(line);
      return (
        normalizedKeywords.some((keyword) => normalizedLine.includes(keyword)) &&
        !normalizedExcludedKeywords.some((keyword) => normalizedLine.includes(keyword))
      );
    })
    .map((line) => line.replaceAll(",", ""))
    .flatMap((line) => Array.from(line.matchAll(/\b\d{5,10}\b/g)).map((match) => Number(match[0])))
    .filter((cost) => Number.isFinite(cost) && cost > 0);

  return costs.length > 0 ? Math.max(...costs) : null;
}

function extractSatisfactionScores(value: string): SatisfactionSummary {
  const detailed = extractDetailedSatisfactionScores(value);
  if (detailed.average || detailed.instructor) {
    return detailed;
  }

  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const averageLine = findScoreLine(lines, ["전체", "평균", "종합", "만족도"], ["강사"]);
  const instructorLine = findScoreLine(lines, ["강사", "만족도"]);
  const average = summarizeSatisfactionValue(averageLine);
  const instructor = summarizeSatisfactionValue(instructorLine);

  return {
    average,
    evidence: truncateEvidence([averageLine, instructorLine].filter(Boolean).join("\n")),
    instructor,
    note: ""
  };
}

function extractDetailedSatisfactionScores(value: string): SatisfactionSummary {
  const sheetTables = splitSheetTables(value);
  const metricSummaries: string[] = [];
  let average = "";
  let instructor = "";
  let responseCount = 0;

  for (const table of sheetTables) {
    const headerIndex = table.rows.findIndex((row) => row.some((cell) => normalize(cell).includes("만족도")));
    if (headerIndex < 0) continue;

    const header = table.rows[headerIndex];
    const dataRows = table.rows
      .slice(headerIndex + 1)
      .filter((row) => row.some((cell) => extractRatingScore(cell) !== null || cell.trim()));

    if (dataRows.length === 0) continue;

    const metrics = [
      { label: "전반 만족도", kind: "average", index: findHeaderIndex(header, ["전반", "만족"]) },
      { label: "난이도 만족도", kind: "support", index: findHeaderIndex(header, ["난이도", "만족"]) },
      { label: "강의 속도 만족도", kind: "support", index: findHeaderIndex(header, ["속도", "만족"]) },
      { label: "강사 만족도", kind: "instructor", index: findHeaderIndex(header, ["강사", "만족"]) }
    ];

    for (const metric of metrics) {
      if (metric.index < 0) continue;

      const scores = dataRows
        .map((row) => extractRatingScore(row[metric.index] ?? ""))
        .filter((score): score is number => score !== null);

      if (scores.length === 0) continue;

      const metricAverage = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      const formatted = metricAverage.toFixed(2);
      responseCount = Math.max(responseCount, scores.length);
      metricSummaries.push(`${metric.label} ${trimFixedScore(formatted)}/5`);

      if (metric.kind === "average" && !average) {
        average = formatted;
      }

      if (metric.kind === "instructor" && !instructor) {
        instructor = formatted;
      }
    }
  }

  if (!average && metricSummaries.length > 0) {
    average = summarizeSatisfactionValue(metricSummaries[0] ?? "");
  }

  const hasInstructorMetric = metricSummaries.some((summary) => summary.includes("강사 만족도"));
  const instructorNote = hasInstructorMetric ? "" : " 강사 만족도 별도 문항 없음.";
  const note = metricSummaries.length > 0 ? `응답 ${responseCount}건 기준: ${metricSummaries.join(", ")}.${instructorNote}` : "";

  return {
    average,
    evidence: truncateEvidence(note),
    instructor,
    note
  };
}

function splitSheetTables(value: string): Array<{ title: string; rows: string[][] }> {
  const tables: Array<{ title: string; rows: string[][] }> = [];
  let currentTitle = "";
  let currentRows: string[][] = [];

  for (const rawLine of value.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("# ")) {
      if (currentRows.length > 0 || currentTitle) {
        tables.push({ title: currentTitle, rows: currentRows });
      }
      currentTitle = line.slice(2).trim();
      currentRows = [];
      continue;
    }

    currentRows.push(line.split("|").map((cell) => cell.trim()));
  }

  if (currentRows.length > 0 || currentTitle) {
    tables.push({ title: currentTitle, rows: currentRows });
  }

  return tables;
}

function findHeaderIndex(header: string[], requiredKeywords: string[]): number {
  const normalizedKeywords = requiredKeywords.map(normalize);
  return header.findIndex((cell) => {
    const normalizedCell = normalize(cell);
    return normalizedKeywords.every((keyword) => normalizedCell.includes(keyword));
  });
}

function extractRatingScore(value: string): number | null {
  const match = value.trim().replace(",", ".").match(/^[^\d]*(\d(?:\.\d{1,2})?)/);
  if (!match) return null;

  const score = Number(match[1]);
  return Number.isFinite(score) && score >= 0 && score <= 5 ? score : null;
}

function trimFixedScore(value: string): string {
  return value.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function findScoreLine(lines: string[], keywords: string[], excludedKeywords: string[] = []): string {
  return lines.find((line) => {
    const normalizedLine = normalize(line);
    const hasKeyword = keywords.some((keyword) => normalizedLine.includes(normalize(keyword)));
    const hasExcludedKeyword = excludedKeywords.some((keyword) => normalizedLine.includes(normalize(keyword)));

    return hasKeyword && !hasExcludedKeyword && summarizeSatisfactionValue(line);
  }) ?? "";
}

function extractTimeText(value: string): string {
  const matches = Array.from(value.matchAll(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?\s*~\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/g));

  return matches
    .map((match) => {
      const [, startHour, startMinute, endHour, endMinute] = match;
      return `${startHour}:${startMinute?.padStart(2, "0") ?? "00"}~${endHour}:${endMinute?.padStart(2, "0") ?? "00"}`;
    })
    .join(", ");
}

function extractActionItems(rows: string[]): string {
  const startIndex = rows.findIndex((row) => normalize(row).includes("actionitems"));
  if (startIndex < 0) return "";

  return rows
    .slice(startIndex + 1, startIndex + 8)
    .filter((row) => !row.includes("담당 | 내용"))
    .join("\n");
}

function extractOperationNotes(rows: string[]): { issue: string; omUpdate: string; summary: string } {
  const parsedRows = rows.map((row) => row.split("|").map((cell) => cell.trim()));
  const issueValues: string[] = [];
  const omValues: string[] = [];
  const summaryValues: string[] = [];

  for (let index = 0; index < parsedRows.length; index += 1) {
    const row = parsedRows[index];
    const issueIndex = findAnyHeaderIndex(row, [
      ["특이사항"],
      ["이슈"],
      ["장애"],
      ["문제"]
    ]);
    const omIndex = findAnyHeaderIndex(row, [
      ["운영진", "의견"],
      ["운영", "의견"],
      ["운영", "메모"],
      ["OM", "업데이트"]
    ]);
    const summaryIndex = findAnyHeaderIndex(row, [
      ["강의", "요약"],
      ["수업", "요약"],
      ["강의", "내용"]
    ]);

    if (issueIndex >= 0 || omIndex >= 0 || summaryIndex >= 0) {
      for (const dataRow of parsedRows.slice(index + 1, index + 40)) {
        if (looksLikeHeaderRow(dataRow)) break;

        pushColumnNote(issueValues, dataRow, issueIndex);
        pushColumnNote(omValues, dataRow, omIndex);
        pushColumnNote(summaryValues, dataRow, summaryIndex);
      }
    }
  }

  return {
    issue: formatNoteList(issueValues, 8),
    omUpdate: formatNoteList(omValues, 8),
    summary: formatNoteList(summaryValues, 6)
  };
}

function pushColumnNote(values: string[], row: string[], index: number) {
  if (index < 0) return;

  const value = cleanupNoteValue(row[index] ?? "");
  if (!value || isPlaceholderValue(value)) return;

  values.push(value);
}

function findAnyHeaderIndex(row: string[], keywordGroups: string[][]): number {
  return row.findIndex((cell) => {
    const normalizedCell = normalize(cell);
    return keywordGroups.some((keywords) => keywords.map(normalize).every((keyword) => normalizedCell.includes(keyword)));
  });
}

function looksLikeHeaderRow(row: string[]): boolean {
  const normalizedRow = normalize(row.join(" "));
  return normalizedRow.includes("강의요약") && (normalizedRow.includes("특이사항") || normalizedRow.includes("운영진의견"));
}

function cleanupNoteValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[-·*]\s*/, "")
    .trim();
}

function isPlaceholderValue(value: string): boolean {
  const normalizedValue = normalize(value);
  return (
    normalizedValue === "없음" ||
    normalizedValue === "해당없음" ||
    normalizedValue === "n/a" ||
    normalizedValue === "-" ||
    normalizedValue === "특이사항" ||
    normalizedValue === "운영진의견" ||
    normalizedValue === "강의요약"
  );
}

function formatNoteList(values: string[], limit: number): string {
  const uniqueValues = Array.from(new Set(values.map(cleanupNoteValue).filter(Boolean))).slice(0, limit);

  return uniqueValues.map((value) => `- ${value}`).join("\n");
}

function dedupeCandidates(candidates: DriveImportCandidate[]): DriveImportCandidate[] {
  const seen = new Set<string>();
  const deduped: DriveImportCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.field}:${candidate.value}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function compareTextReadPriority(a: ScannedDriveFile, b: ScannedDriveFile): number {
  return scoreTextReadPriority(b) - scoreTextReadPriority(a);
}

function scoreTextReadPriority(file: ScannedDriveFile): number {
  const title = normalize(file.title);
  const path = normalize(file.folderPath);
  let score = 0;

  if (isTemplateFile(file.title)) score -= 500;
  if (isSyncupLikeTitle(title)) score += 120;
  if (title.includes("강의관리")) score += 100;
  if (title.includes("응답")) score += 90;
  if (title.includes("만족도") || title.includes("설문") || path.includes("만족도") || path.includes("설문")) score += 80;
  if (title.includes("결과보고")) score += 60;
  if (isSpreadsheet(file.mimeType)) score += 10;
  if (file.mimeType === GOOGLE_DOC_MIME_TYPE) score += 5;

  return score;
}

function isSpreadsheet(mimeType: string): boolean {
  return mimeType === GOOGLE_SHEET_MIME_TYPE || mimeType === XLSX_MIME_TYPE;
}

function isTemplateFile(value: string): boolean {
  const normalizedValue = normalize(value);
  return normalizedValue.startsWith("★newtemplate") || normalizedValue.includes("template") || normalizedValue.includes("템플릿");
}

function isSyncupLikeTitle(normalizedTitle: string): boolean {
  return normalizedTitle.includes("싱크업") || normalizedTitle.includes("강의준비") || normalizedTitle.includes("기획문서");
}

function tokenizeDriveSearchText(value: string): string[] {
  return uniqueStrings(
    value
      .replace(/[()[\]{}]/g, " ")
      .split(/[^0-9a-zA-Z가-힣]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .filter((token) => !isWeakDriveSearchToken(token))
  ).slice(0, 8);
}

function cleanupDriveSearchTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function driveFolderMatchesCompany(folderName: string, companyName: string): boolean {
  const normalizedCompany = normalizeCompanyText(companyName);
  if (!normalizedCompany) return true;

  const normalizedFolderName = normalizeCompanyText(folderName);
  if (normalizedFolderName.includes(normalizedCompany)) return true;

  const folderParts = parseOperationFolderName(folderName);
  const normalizedFolderCompany = normalizeCompanyText(folderParts.companyName ?? "");

  return Boolean(
    normalizedFolderCompany &&
      (normalizedFolderCompany.includes(normalizedCompany) || normalizedCompany.includes(normalizedFolderCompany))
  );
}

function normalizeCompanyText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function formatDriveOwnerName(owner: NonNullable<GoogleDriveFile["owners"]>[number]): string {
  const displayName = owner.displayName?.trim();
  const email = owner.emailAddress?.trim();
  const emailId = email?.split("@")[0] ?? "";
  const koreanName = driveOwnerKoreanName(displayName) ?? driveOwnerKoreanName(emailId) ?? driveOwnerKoreanName(email);

  if (koreanName) return koreanName;
  if (displayName) return displayName;
  if (!emailId) return "";

  return emailId;
}

function driveOwnerKoreanName(value: string | undefined): string | null {
  const key = normalizeDriveOwnerKey(value);
  return key ? DRIVE_OWNER_KOREAN_NAMES[key] ?? null : null;
}

function normalizeDriveOwnerKey(value: string | undefined): string {
  return (value ?? "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildOperationMonthTokens(operation: OperationSession): string[] {
  const start = parseDateOnly(operation.startDate);
  const end = parseDateOnly(operation.endDate);
  const tokens: string[] = [];

  if (start) {
    tokens.push(formatYearMonthToken(start));
  }

  if (end) {
    tokens.push(formatYearMonthToken(end));
  }

  if (start && end && start.getFullYear() === end.getFullYear()) {
    tokens.push(`${String(start.getFullYear()).slice(2)}${String(start.getMonth() + 1).padStart(2, "0")}~${String(end.getFullYear()).slice(2)}${String(end.getMonth() + 1).padStart(2, "0")}`);
  }

  return uniqueStrings(tokens);
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatYearMonthToken(value: Date): string {
  return `${String(value.getUTCFullYear()).slice(2)}${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isWeakDriveSearchToken(value: string): boolean {
  return new Set([
    "ai",
    "ax",
    "dx",
    "교육",
    "과정",
    "강의",
    "실습",
    "활용",
    "기초",
    "심화",
    "특강",
    "온라인",
    "오프라인"
  ]).has(value.toLowerCase());
}

function normalizePersonLikeText(value: string): string {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function normalizePrivateKey(value: string): string {
  return value.trim().replace(/\\n/g, "\n");
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function truncateEvidence(value: string): string {
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}

function hashCandidateValue(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
