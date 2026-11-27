import { isObject, mapPageToCoachRecord, type JsonObject } from "./notionCoachMap";
import type { SyncResult } from "./syncTypes";
import { getCoachNotionSource, getCoachNotionSyncRepository } from "../data/coachNotionSyncRepositoryFactory";
import { applyOneNotionCoach, runNotionCoachSync } from "./coachNotionSyncWorkflow";
import { parseNotionPageId } from "./notionPageLink";
export { parseNotionPageId };
const NOTION_VERSION = "2022-06-28";

const normalizeNotionId = (value: unknown): string => (typeof value === "string" ? value.replace(/-/g, "").toLowerCase() : "");

/** 노션 페이지 1건을 조회한다. 반드시 설정된 코치 DB 소속이어야 한다(아무 노션 페이지나 추가 금지). */
async function fetchOneCoachNotionPage(config: { token: string; databaseId: string }, pageId: string): Promise<JsonObject> {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "GET",
    headers: { authorization: `Bearer ${config.token}`, "notion-version": NOTION_VERSION }
  });
  if (!response.ok) throw new Error("COACH_NOTION_PAGE_FETCH_FAILED");
  const page = (await response.json()) as JsonObject;
  // 소속 가드(긍정형): 반드시 '코치 DB 소속'임을 증명해야 추가한다. parent.database_id가 코치 DB와
  // 일치하지 않으면(없는 경우 포함) 거부 — 다른 DB의 '이름 있는' 페이지가 코치로 들어가는 것을 막는다(fail-closed).
  // ⚠️ NOTION_VERSION을 2025-09-03+(data_source API)로 올리면 parent에 database_id가 없어질 수 있다. 그때는
  //    parent.data_source_id→상위 database 역조회로 이 가드를 함께 갱신해야 한다(안 하면 전부 거부로 막힌다).
  const parent = isObject(page.parent) ? page.parent : {};
  if (normalizeNotionId(parent.database_id) !== normalizeNotionId(config.databaseId)) {
    throw new Error("COACH_NOTION_PAGE_NOT_IN_COACH_DB");
  }
  return page;
}

/**
 * ②/S2: 노션 코치 페이지 '링크 한 개'로 그 코치 1명을 위키에 멱등 추가/동기화한다(OM 권한 route에서 호출).
 * 반드시 runCoachSyncRequest(coachSyncComposition) 스코프 안에서 호출해야 라이브 Mongo로 쓴다(Postgres 직접 금지).
 * 반환 coachId로 운영현황 타입어헤드가 방금 추가한 코치를 바로 선택할 수 있다.
 */
export async function syncOneNotionCoachByLink(linkOrId: string): Promise<{ coachId: string; created: boolean; name: string }> {
  const pageId = parseNotionPageId(linkOrId);
  if (!pageId) throw new Error("COACH_NOTION_LINK_INVALID");
  const config = readNotionConfig();
  const page = await fetchOneCoachNotionPage(config, pageId);
  const record = mapPageToCoachRecord(page);
  if (!record?.name) throw new Error("COACH_NOTION_RECORD_INVALID");
  const { coachId, created } = await applyOneNotionCoach(record, getCoachNotionSyncRepository());
  return { coachId, created, name: record.name };
}

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
