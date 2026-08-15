import type {
  OperationChannel,
  OperationSession,
  OperationStatus,
  SourceTeam,
  OperationType
} from "./operationTypes";
import { getResourceReadCacheTtlMs, readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";

const NOTION_VERSION = "2022-06-28";
const EXCLUDED_TEAM_1_RESOURCE_OWNER_NAMES = new Set(["김별", "김별팀장"]);

interface NotionResourceSourceConfig {
  databaseId?: string;
  excludedOwnerNames?: Set<string>;
  sourceTeam: SourceTeam;
  url?: string;
}

const PROPERTY_NAMES = {
  coach: ["조교명", "조교", "Coach"],
  company: ["기업명", "회사명", "Company"],
  course: ["과정명", "Course"],
  date: ["Date", "날짜", "일정"],
  instructor: ["강의관리", "강사", "Instructor"],
  location: ["강의장소", "장소", "Location"],
  owner: ["운영", "OM", "담당자"],
  planner: ["기획", "LD", "Planner"],
  tags: ["Tags", "태그"]
};

let cachedNotionResourceOperations: TimedCacheEntry<OperationSession[]> | null = null;

interface NotionQueryResponse {
  has_more?: boolean;
  next_cursor?: string | null;
  results?: NotionPage[];
}

interface NotionPage {
  id: string;
  properties?: Record<string, NotionProperty>;
}

type NotionProperty =
  | { type: "date"; date?: { start?: string; end?: string | null } | null }
  | { type: "formula"; formula?: { type?: string; string?: string | null; number?: number | null; boolean?: boolean | null } }
  | { type: "multi_select"; multi_select?: Array<{ name?: string }> }
  | { type: "people"; people?: Array<{ name?: string }> }
  | { type: "rich_text"; rich_text?: NotionText[] }
  | { type: "select"; select?: { name?: string } | null }
  | { type: "title"; title?: NotionText[] }
  | { type: string; [key: string]: unknown };

interface NotionText {
  plain_text?: string;
}

export async function listNotionResourceOperations(): Promise<OperationSession[]> {
  const { entry, value } = await readTimedCache(
    cachedNotionResourceOperations,
    getResourceReadCacheTtlMs(),
    readNotionResourceOperations
  );
  cachedNotionResourceOperations = entry;
  return value;
}

async function readNotionResourceOperations(): Promise<OperationSession[]> {
  const token = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;

  if (!token) {
    return [];
  }

  const operations = await Promise.all(
    getNotionResourceSourceConfigs()
      .filter((config) => config.databaseId || config.url)
      .map((config) => listNotionResourceOperationsForSource(token, config))
  );

  return operations.flat();
}

export function hasNotionResourceConfig() {
  return Boolean(
    (process.env.NOTION_TOKEN || process.env.NOTION_API_KEY) &&
      (process.env.NOTION_TEAM1_RESOURCE_DATABASE_ID ||
        process.env.NOTION_TEAM1_RESOURCE_URL ||
        process.env.NOTION_TEAM2_RESOURCE_DATABASE_ID ||
        process.env.NOTION_TEAM2_RESOURCE_URL)
  );
}

async function listNotionResourceOperationsForSource(token: string | undefined, config: NotionResourceSourceConfig): Promise<OperationSession[]> {
  const databaseId = config.databaseId ?? notionIdFromUrl(config.url);

  if (!token || !databaseId) {
    return [];
  }

  try {
    const pages = await queryAllPages(token, databaseId);
    return pages
      .map((page) => mapPageToOperation(page, config))
      .filter((operation): operation is OperationSession => operation !== null);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function mapPageToOperation(page: NotionPage, config: NotionResourceSourceConfig): OperationSession | null {
  const properties = page.properties ?? {};
  const dateRange = getDateRange(properties);
  if (!dateRange) return null;

  const owner = removeExcludedResourceOwners(getFirstTextProperty(properties, PROPERTY_NAMES.owner), config.excludedOwnerNames);
  const location = getFirstTextProperty(properties, PROPERTY_NAMES.location);
  const channel = getOperationChannel(location);
  const operationType = getOperationType(dateRange.start, dateRange.end);
  const pageTitle = getTitle(properties);
  const courseName = getFirstTextProperty(properties, PROPERTY_NAMES.course) || pageTitle || "과정명 미정";
  const companyName = getFirstTextProperty(properties, PROPERTY_NAMES.company) || "기업명 미정";
  const operationStatus = getOperationStatus(owner, dateRange.end);
  const pageId = page.id.replace(/-/g, "");

  return {
    id: `notion-${pageId}`,
    operationId: `NOTION-${pageId}`,
    sourceTeam: config.sourceTeam,
    courseId: "",
    companyName,
    courseName,
    courseCategory: "",
    tools: "",
    om: owner,
    ld: getFirstTextProperty(properties, PROPERTY_NAMES.planner),
    onsiteOm: "",
    operationStatus,
    archiveStatus: operationStatus === "완료" ? "완료" : "아카이빙전",
    educationFormat: channel === "onsite" ? "오프라인" : channel === "live_online" ? "비대면" : "검토필요",
    educationFormatRaw: location,
    operationChannel: channel,
    operationType,
    operationTypeRaw: operationType,
    roundNo: "",
    educationDays: "",
    startDate: dateRange.start,
    endDate: dateRange.end,
    operationMonth: dateRange.start.slice(0, 7),
    sessionDurationDays: diffDays(dateRange.start, dateRange.end),
    sessionDurationType: operationType,
    timeText: "",
    instructors: getFirstTextProperty(properties, PROPERTY_NAMES.instructor),
    coach: getFirstTextProperty(properties, PROPERTY_NAMES.coach),
    region: "",
    onsiteRequired: channel === "onsite" ? "Y" : channel === "live_online" ? "N" : "UNKNOWN",
    onsiteText: location,
    specialNotes: getFirstTextProperty(properties, PROPERTY_NAMES.tags),
    operationIssue: "",
    omUpdate: "",
    driveLink: "",
    operationDetail: "",
    companyWikiLink: "",
    instructorWikiLink: "",
    revenue: null,
    costRaw: "",
    profitRaw: "",
    totalCost: null,
    instructorCost: null,
    operationCost: null,
    profit: null,
    avgSatisfaction: "",
    instructorSatisfaction: "",
    hasResultReport: "확인필요",
    resultReportLink: "",
    lectureManagementLink: "",
    lectureManagementNote: "",
    padletLink: "",
    validationStatus: "정상",
    validationErrors: []
  };
}

function getNotionResourceSourceConfigs(): NotionResourceSourceConfig[] {
  return [
    getTeam1ResourceSourceConfig(),
    {
      databaseId: process.env.NOTION_TEAM2_RESOURCE_DATABASE_ID,
      sourceTeam: "2팀",
      url: process.env.NOTION_TEAM2_RESOURCE_URL
    }
  ];
}

function getTeam1ResourceSourceConfig(): NotionResourceSourceConfig {
  return {
    databaseId: process.env.NOTION_TEAM1_RESOURCE_DATABASE_ID,
    excludedOwnerNames: EXCLUDED_TEAM_1_RESOURCE_OWNER_NAMES,
    sourceTeam: "1팀",
    url: process.env.NOTION_TEAM1_RESOURCE_URL
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

    if (!response.ok) {
      throw new Error(`Notion resource query failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as NotionQueryResponse;
    pages.push(...(payload.results ?? []));
    startCursor = payload.has_more ? payload.next_cursor ?? null : null;
  } while (startCursor);

  return pages;
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
  if (property.type === "multi_select") return asNameArray(value.multi_select).join(", ");
  if (property.type === "people") return asNameArray(value.people).join(", ");
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

function getOperationStatus(owner: string, endDate: string): OperationStatus {
  if (!owner) return "배정필요";

  const todayKey = toDateKey(new Date());
  return endDate < todayKey ? "완료" : "진행중";
}

function getOperationChannel(location: string): OperationChannel {
  const normalized = location.toLowerCase();
  if (normalized.includes("오프라인") || normalized.includes("offline")) return "onsite";
  if (normalized.includes("zoom") || normalized.includes("온라인") || normalized.includes("online")) return "live_online";
  return "needs_review";
}

function getOperationType(start: string, end: string): OperationType {
  const days = diffDays(start, end);
  if (days === null) return "검토필요";
  if (days <= 1) return "특강";
  if (days <= 7) return "단기";
  if (days <= 31) return "중기";
  if (days <= 93) return "준장기";
  if (days <= 186) return "장기";
  return "상시형";
}

function diffDays(start: string, end: string): number | null {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate || endDate < startDate) return null;

  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function notionIdFromUrl(value: string | undefined): string | undefined {
  const match = value?.match(/[0-9a-f]{32}/i);
  return match?.[0].replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

function removeExcludedResourceOwners(value: string, excludedOwnerNames = new Set<string>()): string {
  return value
    .split(/[,，、/]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => !excludedOwnerNames.has(normalizeOwnerName(name)))
    .join(", ");
}

function normalizeOwnerName(value: string): string {
  return value.replace(/\s+/g, "").replace(/팀장$/g, "");
}
