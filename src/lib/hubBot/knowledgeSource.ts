import { readGoogleSheetValues } from "@/lib/coaches/googleServiceAccount";
import { readNotionPageText } from "@/lib/data/notionPageContent";
import { readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";

const MAX_SECTION_CHARS = 20000;

let cachedKnowledge: TimedCacheEntry<string> | null = null;

export async function getHubBotKnowledge(): Promise<string> {
  const { entry, value } = await readTimedCache(cachedKnowledge, getHubBotCacheTtlMs(), readFreshKnowledge);
  cachedKnowledge = entry;
  return value;
}

async function readFreshKnowledge(): Promise<string> {
  const [processSection, manualSection] = await Promise.all([readProcessSheetSection(), readManualSection()]);

  return [processSection, manualSection].filter(Boolean).join("\n\n");
}

async function readProcessSheetSection(): Promise<string> {
  const sheetId = process.env.HUB_BOT_PROCESS_SHEET_ID?.trim();
  const sheetRange = process.env.HUB_BOT_PROCESS_SHEET_RANGE?.trim();

  if (!sheetId || !sheetRange) {
    return "";
  }

  try {
    const rows = await readGoogleSheetValues(sheetId, sheetRange);
    const text = rows.map((row) => row.join(" | ")).join("\n");
    return `## 전체 운영 프로세스\n${truncate(text)}`;
  } catch (error) {
    console.error("hubBot: 운영 프로세스 시트를 읽지 못했습니다.", error);
    return "";
  }
}

async function readManualSection(): Promise<string> {
  const pageId = process.env.HUB_BOT_MANUAL_NOTION_PAGE_ID?.trim();
  const token = process.env.NOTION_TOKEN?.trim();

  if (!pageId || !token) {
    return "";
  }

  try {
    const text = await readNotionPageText(pageId, token);
    return `## 매뉴얼\n${truncate(text)}`;
  } catch (error) {
    console.error("hubBot: 매뉴얼 Notion 페이지를 읽지 못했습니다.", error);
    return "";
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_SECTION_CHARS) return text;
  return `${text.slice(0, MAX_SECTION_CHARS)}\n(내용이 길어 일부만 표시됩니다.)`;
}

function getHubBotCacheTtlMs(): number {
  const configuredTtl = Number(process.env.HUB_BOT_CACHE_TTL_MS);
  if (Number.isFinite(configuredTtl) && configuredTtl >= 0) {
    return configuredTtl;
  }
  return 15 * 60 * 1000;
}
