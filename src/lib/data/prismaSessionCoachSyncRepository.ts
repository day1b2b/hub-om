// SessionCoachSyncRepository의 기본(Postgres) 구현.
// 저장은 getPrismaClient()의 확장(withPrivacyDatabase=암호화/PII색인, withActivityDatabase=활동기록)을
// 그대로 타므로, 시트 동기화 저장소와 같은 평문 create/update/createMany면 암호화·감사가 자동 적용된다.
// 각 쓰기 트랜잭션은 코치 카탈로그 락을 잡아 시트 동기화와 직렬화한다.
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { lockPrismaCoachCatalog } from "./prismaCoachLock";
import type { ExistingSessionEngagement } from "../coaches/sessionCoachSync";
import type { SessionCoachWriter, SyncSessionInput } from "../coaches/sessionCoachSyncWorkflow";
import { applySessionCoachesByIds } from "../coaches/sessionCoachSyncWorkflow";
import type { SessionCoachSyncInputs, SessionCoachSyncRepository } from "./sessionCoachSyncRepository";

const TXN_TIMEOUT_MS = 60_000;

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

export function getPrismaSessionCoachSyncRepository(): SessionCoachSyncRepository {
  const prisma = getPrismaClient();
  return {
    async readInputs(): Promise<SessionCoachSyncInputs> {
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
          // id 정렬로 Mongo scan(_id 오름차순)과 existing 순서를 일치시켜, 같은 코치의 중복 활성 MANUAL이
          // 있는 비정상 데이터에서도 planSessionCoachSync의 last-wins 선택이 두 백엔드에서 결정적으로 동일하게 한다.
          orderBy: { id: "asc" },
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

      return { sessions, existingBySession, coaches: coachRows };
    },
    async withWriter(write) {
      return prisma.$transaction(
        async (tx) => {
          await lockPrismaCoachCatalog(tx);
          return write(prismaWriter(tx));
        },
        { timeout: TXN_TIMEOUT_MS }
      );
    },
    async setSessionCoaches(operationSessionId, coachIds, today) {
      return prisma.$transaction(
        async (tx) => {
          await lockPrismaCoachCatalog(tx);
          const operation = await tx.operationSession.findFirst({
            where: { id: operationSessionId, deletedAt: null },
            select: { startDate: true, endDate: true, educationDates: true, course: { select: { name: true } } }
          });
          if (!operation) throw new Error("SESSION_COACH_SYNC_SESSION_MISSING");
          const engagementRows = await tx.coachEngagement.findMany({
            where: { operationSessionId },
            orderBy: { id: "asc" },
            select: { id: true, coachId: true, source: true, status: true }
          });
          const existing = engagementRows.map((row) => ({ id: row.id, coachId: row.coachId, source: row.source, status: row.status }));
          return applySessionCoachesByIds(
            {
              operationSessionId,
              courseName: operation.course?.name ?? "",
              coachIds,
              startDate: operation.startDate,
              endDate: operation.endDate,
              scheduleDates: operation.educationDates ?? [],
              startTime: null,
              endTime: null
            },
            existing,
            prismaWriter(tx),
            today
          );
        },
        { timeout: TXN_TIMEOUT_MS }
      );
    }
  };
}
