// 노션 강사 DB → instructor_notes 동기화 (서버 실행).
// 코치 동기화(src/lib/coaches/notionCoachSync.ts)와 같은 구조다. 앱 서버가 노션에서 직접 읽어
// 앱의 DB(내부 연결)에 넣으므로 외부 DB 접속이 필요 없다.
//
// 개인정보(연락처·이메일·생년월일)는 매핑 단계(notionInstructorMap)에서 걷어내 DB에 넣지 않는다.
// OM이 직접 입력한 값(displayName·notes·partnerId)은 갱신 때 덮지 않고 그대로 둔다.
import { getInstructorNotionSource, getInstructorNotionSyncRepository } from "../data/instructorNotionSyncRepositoryFactory";
import { runNotionInstructorSync } from "./instructorNotionSyncWorkflow";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { type SyncResult } from "@/lib/coaches/syncTypes";
import { isObject, type JsonObject } from "./notionInstructorMap";

const NOTION_VERSION = "2022-06-28";

// 노션 서버-투-서버 호출(SYNC_API_SECRET) 또는 관리자 세션만 허용한다.
export async function requireInstructorSyncAccess(request: Request): Promise<string> {
  const configuredSecret = process.env.SYNC_API_SECRET;
  const authorization = request.headers.get("authorization");
  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return "sync-api-secret";
  }
  const session = await assertAdminSession();
  return session.user?.email ?? "admin-session";
}

export async function syncNotionInstructors(dryRun: boolean): Promise<SyncResult> {
  // Resolve the complete explicit scope before reading any external source.
  const repository = getInstructorNotionSyncRepository();
  const source = getInstructorNotionSource();
  let pages: JsonObject[];
  try { pages = await source.readPages(); }
  catch { throw new Error("INSTRUCTOR_NOTION_SOURCE_FAILED"); }
  return runNotionInstructorSync(pages, repository, dryRun);
}

export async function readNotionInstructorPages(): Promise<JsonObject[]> {
  try { return await fetchAllNotionPages(readNotionConfig()); }
  catch { throw new Error("INSTRUCTOR_NOTION_SOURCE_FAILED"); }
}

function readNotionConfig(): { token: string; databaseId: string } {
  const token = process.env.NOTION_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim() || "";
  const databaseId =
    process.env.INSTRUCTOR_NOTION_DATABASE_ID?.trim() || process.env.NOTION_INSTRUCTOR_DATABASE_ID?.trim() || "";

  if (!token) throw new Error("NOTION_TOKEN 또는 NOTION_API_KEY env가 필요합니다.");
  if (!databaseId) throw new Error("INSTRUCTOR_NOTION_DATABASE_ID env(노션 강사 DB ID)가 필요합니다.");
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

    if (!response.ok) throw new Error("INSTRUCTOR_NOTION_SOURCE_FAILED");
    const payload = (await response.json()) as JsonObject;
    const results = Array.isArray(payload.results) ? payload.results.filter(isObject) : [];
    pages.push(...results);
    cursor = payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);

  return pages;
}
