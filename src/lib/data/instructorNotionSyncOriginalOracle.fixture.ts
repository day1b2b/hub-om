/**
 * Independent PG oracle extracted from 3dfa025:
 * src/lib/instructors/notionInstructorSync.ts::syncNotionInstructors.
 * Only source fetching/configuration and client acquisition are replaced by
 * explicit arguments. Loop order, mapper placement, branch decisions, writes,
 * counters and original errorDetail messages remain unchanged.
 * No authorization, external source calls, env reads or new workflow imports.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { emptySyncResult, type SyncResult } from "../coaches/syncTypes";
import { mapPageToInstructor, type JsonObject } from "../instructors/notionInstructorMap";

export async function originalSyncNotionInstructors(
  pages: JsonObject[],
  prisma: Pick<PrismaClient, "instructorNote">,
  dryRun: boolean
): Promise<SyncResult> {
  const result = emptySyncResult(dryRun);
  result.totalRows = pages.length;

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
