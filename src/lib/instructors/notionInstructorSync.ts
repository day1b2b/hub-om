// 노션 강사 DB → instructor_notes 동기화 (서버 실행).
// 코치 동기화(src/lib/coaches/notionCoachSync.ts)와 같은 구조다. 앱 서버가 노션에서 직접 읽어
// 앱의 DB(내부 연결)에 넣으므로 외부 DB 접속이 필요 없다.
//
// 개인정보(연락처·이메일·생년월일)는 매핑 단계(notionInstructorMap)에서 걷어내 DB에 넣지 않는다.
// OM이 직접 입력한 값(displayName·notes·partnerId)은 갱신 때 덮지 않고 그대로 둔다.
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { emptySyncResult, type SyncResult } from "@/lib/coaches/syncTypes";
import { isObject, mapPageToInstructor, type JsonObject } from "./notionInstructorMap";

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
  const config = readNotionConfig();
  const pages = await fetchAllNotionPages(config);
  const result = emptySyncResult(dryRun);
  result.totalRows = pages.length;

  const prisma = getPrismaClient();

  for (const page of pages) {
    const mapped = mapPageToInstructor(page);
    if (!mapped) {
      result.skipped++;
      continue;
    }
    const { name, notionNo, note } = mapped;

    try {
      // 연결 키는 노션 NO다. 이름은 노션에서 바뀔 수 있고 동명이인도 있어 키가 될 수 없다.
      const existing = await prisma.instructorNote.findUnique({
        where: { notionNo },
        select: { id: true, recruitAvoid: true, instructorName: true }
      });

      // NO가 아직 안 붙은 예전 행(이름으로만 저장돼 있던 것)을 이름으로 찾아 이어 붙인다.
      // 이렇게 첫 동기화가 스스로 backfill 하므로 별도 스크립트가 필요 없다.
      const legacy = existing
        ? null
        : await prisma.instructorNote.findFirst({
            where: { instructorName: name, notionNo: null },
            select: { id: true, recruitAvoid: true, instructorName: true }
          });
      const target = existing ?? legacy;

      if (dryRun) {
        result.changes?.push({
          coachName: name,
          action: target ? "update_notion" : "create_notion",
          details: !target
            ? "신규 강사"
            : !existing
              ? `NO ${notionNo} 연결(예전 행)`
              : target.instructorName !== name
                ? `이름 변경 ${target.instructorName} → ${name}`
                : "노션 프로필 갱신"
        });
        if (target) result.updated++;
        else result.created++;
        continue;
      }

      const notionProfile = (note.notion ?? null) as Prisma.InputJsonValue;
      const syncedAt = note.notion?.syncedAt ? new Date(note.notion.syncedAt) : null;

      if (target) {
        // OM 입력값(displayName·notes·partnerId)은 건드리지 않는다. 노션 스냅샷만 갱신.
        // 섭외지양은 한쪽에서 켜졌으면 유지(OR)해 실수로 꺼지지 않게 한다.
        // 이름은 노션 값으로 맞춘다. NO가 키이므로 이름은 따라오는 값이다.
        await prisma.instructorNote.update({
          where: { id: target.id },
          data: {
            notionNo,
            instructorName: name,
            ...(note.notionId ? { notionId: note.notionId } : {}),
            recruitAvoid: target.recruitAvoid || (note.recruitAvoid ?? false),
            notionProfile,
            notionSyncedAt: syncedAt
          }
        });
        result.updated++;
      } else {
        await prisma.instructorNote.create({
          data: {
            notionNo,
            instructorName: name,
            ...(note.notionId ? { notionId: note.notionId } : {}),
            recruitAvoid: note.recruitAvoid ?? false,
            notionProfile,
            notionSyncedAt: syncedAt
          }
        });
        result.created++;
      }
    } catch (error) {
      result.errors++;
      result.errorDetail.push(`NO ${notionNo} ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
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

    if (!response.ok) throw new Error(`Notion API error (${response.status}): ${await response.text()}`);
    const payload = (await response.json()) as JsonObject;
    const results = Array.isArray(payload.results) ? payload.results.filter(isObject) : [];
    pages.push(...results);
    cursor = payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);

  return pages;
}
