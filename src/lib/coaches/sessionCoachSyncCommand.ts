// 운영현황 '실습코치'(coachText) → 그 회차의 MANUAL 투입(CoachEngagement) 백필 커맨드.
// 정본=운영현황 실습코치(OM 확정값). 삭제되지 않은 회차만 읽어, 코치위키 명부로 이름을 풀고
// syncSessionCoaches로 생성/전환(SHEET→MANUAL)/취소를 계획·실행한다. 삭제는 하지 않는다(평가 보존).
//
// 저장은 getPrismaClient()의 확장(withPrivacyDatabase=암호화/PII색인, withActivityDatabase=활동기록)을
// 그대로 타므로, 시트 동기화 저장소와 같은 평문 create/update/createMany면 암호화·감사가 자동 적용된다.
// 회차 수가 많을 수 있어 청크 단위 트랜잭션으로 쪼개 쓰고, 각 트랜잭션은 코치 카탈로그 락을 잡아
// 시트 동기화와 직렬화한다.
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../data/prisma";
import { lockPrismaCoachCatalog } from "../data/prismaCoachLock";
import { normalizeCoachName } from "./accessToken";
import type { ExistingSessionEngagement } from "./sessionCoachSync";
import {
  syncSessionCoaches,
  type SessionCoachSyncResult,
  type SessionCoachWriter,
  type SyncCoach,
  type SyncSessionInput
} from "./sessionCoachSyncWorkflow";

const CHUNK_SIZE = 50;
const TXN_TIMEOUT_MS = 60_000;

/** dry-run에서 실수로 쓰기가 일어나면 즉시 터뜨린다(쓰기 없음 보장). */
const DRY_RUN_WRITER: SessionCoachWriter = {
  async createEngagement() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async replaceSchedules() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async convertToManual() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async reactivateEngagements() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async cancelEngagements() { throw new Error("dry-run에서는 쓰지 않는다"); }
};

/** 실제 쓰기: 시트 동기화 저장소(prismaCoachSheetSyncRepository)와 같은 평문 경로를 쓴다. */
function prismaWriter(tx: Prisma.TransactionClient): SessionCoachWriter {
  return {
    async createEngagement(input) {
      const row = await tx.coachEngagement.create({
        data: {
          sourceEngagementId: input.sourceEngagementId,
          coachId: input.coachId,
          operationSessionId: input.operationSessionId,
          courseName: input.courseName,
          status: input.status,
          source: input.source,
          startDate: input.startDate,
          endDate: input.endDate,
          startTime: input.startTime,
          endTime: input.endTime
        },
        select: { id: true }
      });
      return { id: row.id };
    },
    async replaceSchedules(engagementId, rows) {
      await tx.coachEngagementSchedule.deleteMany({ where: { engagementId } });
      if (rows.length > 0) {
        await tx.coachEngagementSchedule.createMany({
          data: rows.map((row) => ({
            sourceEngagementScheduleId: row.sourceEngagementScheduleId,
            engagementId: row.engagementId,
            coachId: row.coachId,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime
          }))
        });
      }
    },
    async convertToManual(ids) {
      // 소량(같은 회차의 매칭된 SHEET)이라 단건 update로 확장(암호화/활동) 경로를 그대로 탄다.
      for (const id of ids) await tx.coachEngagement.update({ where: { id }, data: { source: "MANUAL" } });
    },
    async reactivateEngagements(ids, status) {
      // 취소됐던 MANUAL을 되살림: status를 회차 날짜 기준으로 복구, source는 MANUAL 유지.
      for (const id of ids) await tx.coachEngagement.update({ where: { id }, data: { status, source: "MANUAL" } });
    },
    async cancelEngagements(ids) {
      for (const id of ids) await tx.coachEngagement.update({ where: { id }, data: { status: "CANCELLED" } });
    }
  };
}

/** 정규화 이름이 겹치는 코치는 모두 빼서(동명이인 오배정 방지) 그 이름은 unmatched로 떨어지게 한다. */
function rosterWithoutNameCollisions(coaches: ReadonlyArray<{ id: string; name: string }>): SyncCoach[] {
  const byName = new Map<string, Array<{ id: string; name: string }>>();
  for (const coach of coaches) {
    const key = normalizeCoachName(coach.name);
    byName.set(key, [...(byName.get(key) ?? []), coach]);
  }
  const out: SyncCoach[] = [];
  for (const group of byName.values()) if (group.length === 1) out.push({ id: group[0].id, name: group[0].name });
  return out;
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function mergeResult(into: SessionCoachSyncResult, part: SessionCoachSyncResult): void {
  into.checkedSessions += part.checkedSessions;
  into.created += part.created;
  into.converted += part.converted;
  into.reactivated += part.reactivated;
  into.cancelled += part.cancelled;
  into.unmatched.push(...part.unmatched);
}

export interface RunSessionCoachSyncOptions {
  apply: boolean;
  today?: Date;
}

/**
 * 커맨드 본체: 회차·명부·기존 투입을 읽어 동기화 계획을 세우고(dry-run) 또는 실행(apply)한다.
 * 읽기는 트랜잭션 밖에서 하고, 쓰기만 청크 트랜잭션(카탈로그 락) 안에서 한다.
 */
export async function runSessionCoachSync(options: RunSessionCoachSyncOptions): Promise<SessionCoachSyncResult> {
  const { apply, today = new Date() } = options;
  const prisma = getPrismaClient();

  const [sessionRows, engagementRows, coachRows] = await Promise.all([
    prisma.operationSession.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        coachText: true,
        startDate: true,
        endDate: true,
        educationDates: true,
        course: { select: { name: true } }
      }
    }),
    prisma.coachEngagement.findMany({
      where: { operationSessionId: { not: null } },
      select: { id: true, coachId: true, operationSessionId: true, source: true, status: true }
    }),
    prisma.coach.findMany({ where: { deletedAt: null }, select: { id: true, name: true } })
  ]);

  const sessions: SyncSessionInput[] = sessionRows.map((row) => ({
    operationSessionId: row.id,
    courseName: row.course?.name ?? "",
    coachText: row.coachText,
    startDate: row.startDate,
    endDate: row.endDate,
    scheduleDates: row.educationDates ?? [],
    startTime: null, // 회차 timeText 파싱은 신뢰도가 낮아 기본값(09:00~18:00)을 쓴다.
    endTime: null
  }));

  const existingBySession = new Map<string, ExistingSessionEngagement[]>();
  for (const row of engagementRows) {
    if (!row.operationSessionId) continue;
    const list = existingBySession.get(row.operationSessionId) ?? [];
    list.push({ id: row.id, coachId: row.coachId, source: row.source, status: row.status });
    existingBySession.set(row.operationSessionId, list);
  }

  const coaches = rosterWithoutNameCollisions(coachRows);

  if (!apply) {
    return syncSessionCoaches(sessions, existingBySession, coaches, DRY_RUN_WRITER, today, true);
  }

  const total: SessionCoachSyncResult = { checkedSessions: 0, created: 0, converted: 0, reactivated: 0, cancelled: 0, unmatched: [], apply: true };
  for (const part of chunk(sessions, CHUNK_SIZE)) {
    const partResult = await prisma.$transaction(
      async (tx) => {
        await lockPrismaCoachCatalog(tx);
        return syncSessionCoaches(part, existingBySession, coaches, prismaWriter(tx), today, false);
      },
      { timeout: TXN_TIMEOUT_MS }
    );
    mergeResult(total, partResult);
  }
  return total;
}
