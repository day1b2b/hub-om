import { parseImportFile, type ParsedImportFile } from "./importUploadParser";

const NOTION_VERSION = "2022-06-28";

const PROPERTY_NAMES = {
  coach: ["조교명", "조교", "Coach"],
  companyName: ["기업명", "회사명", "Company", "기업"],
  courseName: ["과정명", "Course", "교육명"],
  date: ["Date", "날짜", "일정", "교육일"],
  educationFormat: ["교육형태", "운영형태", "진행방식"],
  instructors: ["강의관리", "강사", "Instructor", "강사명"],
  ld: ["기획", "LD", "Planner", "담당LD"],
  om: ["운영", "OM", "담당자", "담당OM"],
  operationStatus: ["상태", "진행상태", "운영상태"],
  region: ["강의장소", "장소", "Location", "지역"],
  roundNo: ["차수", "회차", "Round"],
  specialNotes: ["Tags", "태그", "메모", "특이사항"],
  timeText: ["시간", "교육시간", "Time"]
};

interface NotionQueryResponse {
  has_more?: boolean;
  next_cursor?: string | null;
  results?: NotionPage[];
}

interface NotionPage {
  id: string;
  properties?: Record<string, NotionProperty>;
  url?: string;
}

type NotionProperty =
  | { type: "date"; date?: { start?: string; end?: string | null } | null }
  | { type: "formula"; formula?: { type?: string; string?: string | null; number?: number | null; boolean?: boolean | null } }
  | { type: "multi_select"; multi_select?: Array<{ name?: string }> }
  | { type: "people"; people?: Array<{ name?: string }> }
  | { type: "rich_text"; rich_text?: NotionText[] }
  | { type: "select"; select?: { name?: string } | null }
  | { type: "status"; status?: { name?: string } | null }
  | { type: "title"; title?: NotionText[] }
  | { type: "url"; url?: string | null }
  | { type: string; [key: string]: unknown };

interface NotionText {
  plain_text?: string;
}

export interface NotionImportReadResult {
  databaseId: string;
  parsed: ParsedImportFile;
  rowCount: number;
}

export async function readNotionDatabaseImport(input: {
  databaseUrlOrId: string;
  token: string;
}): Promise<NotionImportReadResult> {
  const databaseId = notionDatabaseIdFromValue(input.databaseUrlOrId);
  if (!databaseId) {
    throw new Error("Notion 데이터베이스 URL 또는 ID를 확인해 주세요.");
  }

  const pages = await queryAllPages(input.token, databaseId);
  const rows = pages.map(notionPageToImportRow).filter((row) => Object.keys(row).length > 0);
  const parsed = parseImportFile("notion.json", JSON.stringify(rows));

  return {
    databaseId,
    parsed,
    rowCount: pages.length
  };
}

async function queryAllPages(token: string, databaseId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let startCursor: string | null = null;

  do {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION
      },
      body: JSON.stringify({
        page_size: 100,
        start_cursor: startCursor ?? undefined
      }),
      cache: "no-store"
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("Notion 통합 토큰 권한이 없습니다. 해당 데이터베이스에 Notion 통합을 초대했는지 확인해 주세요.");
    }

    if (!response.ok) {
      throw new Error(`Notion 데이터베이스를 읽지 못했습니다. ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as NotionQueryResponse;
    pages.push(...(payload.results ?? []));
    startCursor = payload.has_more ? payload.next_cursor ?? null : null;
  } while (startCursor);

  return pages;
}

function notionPageToImportRow(page: NotionPage): Record<string, string> {
  const properties = page.properties ?? {};
  const dateRange = getDateRange(properties);
  const pageId = page.id.replaceAll("-", "");
  const pageTitle = getTitle(properties);
  const courseName = getFirstTextProperty(properties, PROPERTY_NAMES.courseName) || pageTitle;

  return removeEmptyValues({
    "운영ID": `NOTION-${pageId}`,
    "기업명": getFirstTextProperty(properties, PROPERTY_NAMES.companyName),
    "과정명": courseName,
    "시작일": dateRange?.start ?? "",
    "종료일": dateRange?.end ?? "",
    "담당OM": getFirstTextProperty(properties, PROPERTY_NAMES.om),
    "담당LD": getFirstTextProperty(properties, PROPERTY_NAMES.ld),
    "강사": getFirstTextProperty(properties, PROPERTY_NAMES.instructors),
    "코치": getFirstTextProperty(properties, PROPERTY_NAMES.coach),
    "지역": getFirstTextProperty(properties, PROPERTY_NAMES.region),
    "교육형태": getFirstTextProperty(properties, PROPERTY_NAMES.educationFormat),
    "상태": getFirstTextProperty(properties, PROPERTY_NAMES.operationStatus),
    "차수": getFirstTextProperty(properties, PROPERTY_NAMES.roundNo),
    "시간": getFirstTextProperty(properties, PROPERTY_NAMES.timeText),
    "특이사항": getFirstTextProperty(properties, PROPERTY_NAMES.specialNotes),
    "싱크업": page.url ?? ""
  });
}

function getDateRange(properties: Record<string, NotionProperty>) {
  for (const propertyName of PROPERTY_NAMES.date) {
    const property = properties[propertyName] as { type?: string; date?: { start?: string; end?: string | null } | null } | undefined;
    if (property?.type !== "date" || !property.date?.start) continue;

    return {
      start: property.date.start.slice(0, 10),
      end: (property.date.end ?? property.date.start).slice(0, 10)
    };
  }

  return null;
}

function getTitle(properties: Record<string, NotionProperty>): string {
  for (const value of Object.values(properties)) {
    if (value.type === "title") {
      const text = propertyToText(value);
      if (text) return text;
    }
  }

  return "";
}

function getFirstTextProperty(properties: Record<string, NotionProperty>, propertyNames: string[]): string {
  for (const propertyName of propertyNames) {
    const value = propertyToText(properties[propertyName]);
    if (value) return value;
  }

  return "";
}

function propertyToText(property: NotionProperty | undefined): string {
  if (!property) return "";

  const value = property as Record<string, unknown>;

  if (property.type === "title") return textArrayToString(asTextArray(value.title));
  if (property.type === "rich_text") return textArrayToString(asTextArray(value.rich_text));
  if (property.type === "select") return asName(value.select);
  if (property.type === "status") return asName(value.status);
  if (property.type === "multi_select") return asNameArray(value.multi_select).join(", ");
  if (property.type === "people") return asNameArray(value.people).join(", ");
  if (property.type === "url") return typeof value.url === "string" ? value.url.trim() : "";
  if (property.type === "date") {
    const date = value.date as { start?: string } | null | undefined;
    return date?.start?.slice(0, 10) ?? "";
  }
  if (property.type === "formula") {
    const formula = value.formula as Record<string, unknown> | undefined;
    if (formula?.type === "string") return typeof formula.string === "string" ? formula.string.trim() : "";
    if (formula?.type === "number" && typeof formula.number === "number") return String(formula.number);
    if (formula?.type === "boolean" && typeof formula.boolean === "boolean") return String(formula.boolean);
  }

  return "";
}

function textArrayToString(texts: NotionText[]): string {
  return texts.map((text) => text.plain_text ?? "").join("").trim();
}

function asTextArray(value: unknown): NotionText[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is NotionText => typeof item === "object" && item !== null);
}

function asName(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name.trim() : "";
}

function asNameArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.map(asName).filter(Boolean);
}

function notionDatabaseIdFromValue(value: string): string | null {
  const compactId = value.match(/[0-9a-f]{32}/i)?.[0];
  if (compactId) {
    return compactId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  }

  const dashedId = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  return dashedId ?? null;
}

function removeEmptyValues(row: Record<string, string>) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value.trim()));
}
