import type { SourceTeam } from "./operationTypes";
import type { ResourceOwnerRoster, TeamMemberRepository } from "./teamMemberRepository";

const NOTION_VERSION = "2022-06-28";
const DEFAULT_NAME_PROPERTIES = ["이름", "Name", "name", "담당자", "OM"];
const DEFAULT_ACTIVE_PROPERTIES = ["활성", "Active", "active", "사용", "사용여부"];

interface NotionTeamMemberRepositoryOptions {
  fallback: TeamMemberRepository;
  sources: NotionTeamMemberSource[];
  token?: string;
}

interface NotionTeamMemberSource {
  databaseId?: string;
  nameProperties?: string[];
  sourceTeam: SourceTeam;
  url?: string;
}

interface NotionQueryResponse {
  has_more?: boolean;
  next_cursor?: string | null;
  results?: NotionPage[];
}

interface NotionPage {
  properties?: Record<string, NotionProperty>;
}

type NotionProperty =
  | { type: "checkbox"; checkbox?: boolean }
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

export class NotionTeamMemberRepository implements TeamMemberRepository {
  constructor(private readonly options: NotionTeamMemberRepositoryOptions) {}

  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    const fallbackRoster = await this.options.fallback.listResourceOwners();

    if (!this.options.token) {
      return fallbackRoster;
    }

    const sourceRosters = await Promise.all(
      this.options.sources
        .filter((source) => source.databaseId || source.url)
        .map(async (source) => ({
          owners: await this.listOwnersFromNotion(source).catch((error: unknown) => {
            console.error(error);
            return [];
          }),
          sourceTeam: source.sourceTeam
        }))
    );

    return sourceRosters.reduce(
      (roster, sourceRoster) => {
        if (sourceRoster.owners.length > 0) {
          roster[sourceRoster.sourceTeam] = sourceRoster.owners;
        }

        return roster;
      },
      { ...fallbackRoster }
    );
  }

  private async listOwnersFromNotion(source: NotionTeamMemberSource): Promise<string[]> {
    const databaseId = source.databaseId ?? notionIdFromUrl(source.url);
    if (!databaseId || !this.options.token) return [];

    const pages = await this.queryAllPages(databaseId);
    const nameProperties = source.nameProperties ?? DEFAULT_NAME_PROPERTIES;

    return unique(
      pages
        .filter((page) => isActiveNotionPage(page.properties ?? {}))
        .map((page) => getFirstTextProperty(page.properties ?? {}, nameProperties))
        .filter((name) => name.length > 0)
    );
  }

  private async queryAllPages(databaseId: string): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let startCursor: string | null = null;

    do {
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.options.token}`,
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
        throw new Error(`Notion team member query failed: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as NotionQueryResponse;
      pages.push(...(payload.results ?? []));
      startCursor = payload.has_more ? payload.next_cursor ?? null : null;
    } while (startCursor);

    return pages;
  }
}

export function getNotionTeamMemberRepository(fallback: TeamMemberRepository): TeamMemberRepository {
  return new NotionTeamMemberRepository({
    fallback,
    sources: [
      {
        databaseId: process.env.NOTION_TEAM1_RESOURCE_DATABASE_ID,
        nameProperties: parsePropertyNames(process.env.NOTION_TEAM1_RESOURCE_NAME_PROPERTIES),
        sourceTeam: "1팀",
        url: process.env.NOTION_TEAM1_RESOURCE_URL
      },
      {
        databaseId: process.env.NOTION_TEAM2_RESOURCE_DATABASE_ID,
        nameProperties: parsePropertyNames(process.env.NOTION_TEAM2_RESOURCE_NAME_PROPERTIES),
        sourceTeam: "2팀",
        url: process.env.NOTION_TEAM2_RESOURCE_URL
      }
    ],
    token: process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY
  });
}

function getFirstTextProperty(properties: Record<string, NotionProperty>, propertyNames: string[]): string {
  for (const propertyName of propertyNames) {
    const value = propertyToText(properties[propertyName]);
    if (value) return value;
  }

  for (const value of Object.values(properties)) {
    if (value.type === "title") {
      const text = propertyToText(value);
      if (text) return text;
    }
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

function isActiveNotionPage(properties: Record<string, NotionProperty>): boolean {
  for (const propertyName of DEFAULT_ACTIVE_PROPERTIES) {
    const property = properties[propertyName];
    if (!property) continue;

    if (property.type === "checkbox") return property.checkbox !== false;

    const value = propertyToText(property).toLowerCase();
    if (["false", "n", "no", "inactive", "퇴사", "비활성", "미사용"].includes(value)) return false;
  }

  return true;
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

function parsePropertyNames(value: string | undefined): string[] | undefined {
  const names = value
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return names && names.length > 0 ? names : undefined;
}

function notionIdFromUrl(value: string | undefined): string | undefined {
  const match = value?.match(/[0-9a-f]{32}/i);
  return match?.[0].replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
