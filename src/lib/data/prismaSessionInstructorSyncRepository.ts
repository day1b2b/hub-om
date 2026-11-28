// SessionInstructorSyncRepository의 기본(Postgres) 구현. 코치 prismaSessionCoachSyncRepository 미러.
// 저장은 getPrismaClient()의 확장(withPrivacyDatabase=암호화/PII색인, withActivityDatabase=활동기록)을
// 그대로 타므로 평문 create/update/createMany면 암호화·감사가 자동 적용된다.
// 각 쓰기 트랜잭션은 강사 카탈로그 락을 잡아 동시 쓰기와 직렬화한다.
// 강사 명부 = InstructorNote(노션 강사 미러). 이름은 displayName ?? instructorName(드롭다운 옵션과 동일).
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { lockPrismaInstructorCatalog } from "./prismaInstructorLock";
import type { ExistingSessionInstructorEngagement } from "../instructors/sessionInstructorSync";
import type { SessionInstructorWriter, SyncInstructorSessionInput } from "../instructors/sessionInstructorSyncWorkflow";
import { applySessionInstructorsByIds } from "../instructors/sessionInstructorSyncWorkflow";
import type { SessionInstructorSyncInputs, SessionInstructorSyncRepository } from "./sessionInstructorSyncRepository";

const TXN_TIMEOUT_MS = 60_000;

/** 실제 쓰기: 평문 경로(확장이 암호화·감사 자동 적용). */
function prismaWriter(tx: Prisma.TransactionClient): SessionInstructorWriter {
  return {
    async createEngagement(input) {
      const row = await tx.instructorEngagement.create({
        data: {
          sourceEngagementId: input.sourceEngagementId,
          instructorNoteId: input.instructorNoteId,
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
      await tx.instructorEngagementSchedule.deleteMany({ where: { engagementId } });
      if (rows.length > 0) {
        await tx.instructorEngagementSchedule.createMany({
          data: rows.map((row) => ({
            sourceEngagementScheduleId: row.sourceEngagementScheduleId,
            engagementId: row.engagementId,
            instructorNoteId: row.instructorNoteId,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime
          }))
        });
      }
    },
    async convertToManual(ids) {
      // 소량(같은 회차의 매칭된 CONTRACT)이라 단건 update로 확장(암호화/활동) 경로를 그대로 탄다.
      for (const id of ids) await tx.instructorEngagement.update({ where: { id }, data: { source: "MANUAL" } });
    },
    async reactivateEngagements(ids, status) {
      // 취소됐던 MANUAL을 되살림: status를 회차 날짜 기준으로 복구, source는 MANUAL 유지.
      for (const id of ids) await tx.instructorEngagement.update({ where: { id }, data: { status, source: "MANUAL" } });
    },
    async cancelEngagements(ids) {
      for (const id of ids) await tx.instructorEngagement.update({ where: { id }, data: { status: "CANCELLED" } });
    }
  };
}

export function getPrismaSessionInstructorSyncRepository(): SessionInstructorSyncRepository {
  const prisma = getPrismaClient();
  return {
    async readInputs(): Promise<SessionInstructorSyncInputs> {
      const [sessionRows, engagementRows, instructorRows] = await Promise.all([
        prisma.operationSession.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            instructorsText: true,
            startDate: true,
            endDate: true,
            educationDates: true,
            course: { select: { name: true } }
          }
        }),
        prisma.instructorEngagement.findMany({
          where: { operationSessionId: { not: null } },
          // id 정렬로 Mongo scan(_id 오름차순)과 existing 순서를 일치시켜 두 백엔드 결정 동일하게.
          orderBy: { id: "asc" },
          select: { id: true, instructorNoteId: true, operationSessionId: true, source: true, status: true }
        }),
        prisma.instructorNote.findMany({ select: { id: true, instructorName: true, displayName: true } })
      ]);

      const sessions: SyncInstructorSessionInput[] = sessionRows.map((row) => ({
        operationSessionId: row.id,
        courseName: row.course?.name ?? "",
        instructorsText: row.instructorsText,
        startDate: row.startDate,
        endDate: row.endDate,
        scheduleDates: row.educationDates ?? [],
        startTime: null, // 회차 timeText 파싱은 신뢰도가 낮아 기본값(09:00~18:00)을 쓴다.
        endTime: null
      }));

      const existingBySession = new Map<string, ExistingSessionInstructorEngagement[]>();
      for (const row of engagementRows) {
        if (!row.operationSessionId) continue;
        const list = existingBySession.get(row.operationSessionId) ?? [];
        list.push({ id: row.id, instructorNoteId: row.instructorNoteId, source: row.source, status: row.status });
        existingBySession.set(row.operationSessionId, list);
      }

      const instructors = instructorRows.map((row) => ({ id: row.id, name: (row.displayName ?? row.instructorName) }));
      return { sessions, existingBySession, instructors };
    },
    async withWriter(write) {
      return prisma.$transaction(
        async (tx) => {
          await lockPrismaInstructorCatalog(tx);
          return write(prismaWriter(tx));
        },
        { timeout: TXN_TIMEOUT_MS }
      );
    },
    async setSessionInstructors(operationSessionId, instructorNoteIds, today) {
      return prisma.$transaction(
        async (tx) => {
          await lockPrismaInstructorCatalog(tx);
          const operation = await tx.operationSession.findFirst({
            where: { id: operationSessionId, deletedAt: null },
            select: { startDate: true, endDate: true, educationDates: true, course: { select: { name: true } } }
          });
          if (!operation) throw new Error("SESSION_INSTRUCTOR_SYNC_SESSION_MISSING");
          const engagementRows = await tx.instructorEngagement.findMany({
            where: { operationSessionId },
            orderBy: { id: "asc" },
            select: { id: true, instructorNoteId: true, source: true, status: true }
          });
          const existing = engagementRows.map((row) => ({ id: row.id, instructorNoteId: row.instructorNoteId, source: row.source, status: row.status }));
          return applySessionInstructorsByIds(
            {
              operationSessionId,
              courseName: operation.course?.name ?? "",
              instructorNoteIds,
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
