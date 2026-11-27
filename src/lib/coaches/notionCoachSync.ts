import { isObject, mapPageToCoachRecord, type JsonObject } from "./notionCoachMap";
import type { SyncResult } from "./syncTypes";
import { getCoachNotionSource, getCoachNotionSyncRepository } from "../data/coachNotionSyncRepositoryFactory";
import { applyOneNotionCoach, runNotionCoachSync } from "./coachNotionSyncWorkflow";
const NOTION_VERSION = "2022-06-28";

/** 노션 페이지 URL/ID에서 32자리 hex 페이지 ID를 뽑는다. 없으면 null(=잘못된 링크). */
export function parseNotionPageId(linkOrId: string): string | null {
  const hex = String(linkOrId).replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return hex ? hex[0].toLowerCase() : null;
}

const normalizeNotionId = (value: unknown): string => (typeof value === "string" ? value.replace(/-/g, "").toLowerCase() : "");

/** 노션 페이지 1건을 조회한다. 반드시 설정된 코치 DB 소속이어야 한다(아무 노션 페이지나 추가 금지). */
async function fetchOneCoachNotionPage(config: { token: string; databaseId: string }, pageId: string): Promise<JsonObject> {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "GET",
    headers: { authorization: `Bearer ${config.token}`, "notion-version": NOTION_VERSION }
  });
  if (!response.ok) throw new Error("COACH_NOTION_PAGE_FETCH_FAILED");
  const page = (await response.json()) as JsonObject;
  // 소속 가드: database_id가 있으면 코치 DB와 일치해야 한다. (data_source로 쪼개져 database_id가 없으면
  // 아래 레코드 매핑의 '이름 필수'가 구조적 가드 역할을 한다.)
  const parent = isObject(page.parent) ? page.parent : {};
  const parentDb = normalizeNotionId(parent.database_id);
  if (parentDb && parentDb !== normalizeNotionId(config.databaseId)) throw new Error("COACH_NOTION_PAGE_NOT_IN_COACH_DB");
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
