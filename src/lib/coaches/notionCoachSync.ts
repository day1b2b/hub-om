import { isObject, type JsonObject } from "./notionCoachMap";
import type { SyncResult } from "./syncTypes";
import { getCoachNotionSource, getCoachNotionSyncRepository } from "../data/coachNotionSyncRepositoryFactory";
import { runNotionCoachSync } from "./coachNotionSyncWorkflow";
const NOTION_VERSION = "2022-06-28";

export async function syncNotionCoaches(dryRun: boolean): Promise<SyncResult> {
  const repository = getCoachNotionSyncRepository();
  const source = getCoachNotionSource();
  let pages: JsonObject[];
  try { pages = await source.readPages(); }
  catch { throw new Error("COACH_NOTION_SOURCE_FAILED"); }
  return runNotionCoachSync(pages, repository, dryRun);
}

export async function readNotionCoachPages(): Promise<JsonObject[]> {
  try { return await fetchAllNotionPages(readNotionConfig()); }
  catch { throw new Error("COACH_NOTION_SOURCE_FAILED"); }
}

function readNotionConfig(): { token: string; databaseId: string } {
  const token = process.env.NOTION_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim() || "";
  const databaseId =
    process.env.COACH_NOTION_DATABASE_ID?.trim() ||
    process.env.NOTION_DATABASE_ID?.trim() ||
    process.env.NOTION_IMPORT_DATABASE_ID?.trim() ||
    "";

  if (!token) throw new Error("NOTION_TOKEN 또는 NOTION_API_KEY env가 필요합니다.");
  if (!databaseId) throw new Error("COACH_NOTION_DATABASE_ID 또는 NOTION_DATABASE_ID env가 필요합니다.");
  return { token, databaseId };
}

async function fetchAllNotionPages(config: { token: string; databaseId: string }): Promise<JsonObject[]> {
  const pages: JsonObject[] = [];
  let cursor: string | undefined;

  do {
    const response = await fetch(`https://api.notion.com/v1/databases/${config.databaseId}/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "notion-version": NOTION_VERSION,
        "content-type": "application/json"
      },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });

    if (!response.ok) throw new Error("COACH_NOTION_SOURCE_FAILED");
    const payload = (await response.json()) as JsonObject;
    const results = Array.isArray(payload.results) ? payload.results.filter(isObject) : [];
    pages.push(...results);
    cursor = payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);

  return pages;
}
