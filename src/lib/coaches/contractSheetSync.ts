import { CoachEngagementSource, CoachEngagementStatus, CoachStatus, type Prisma } from "@prisma/client";
import { generateCoachAccessToken, normalizeCoachName } from "./accessToken";
import { parseLooseDate, toDateKey } from "./dateParse";
import { readGoogleSpreadsheetRows } from "./googleServiceAccount";
import { cell, expandWeekdaySchedules, normalizeEmail, normalizePhone, parseWorkSchedules, type WorkSchedule } from "./sheetParsers";
import type { SyncResult } from "./syncTypes";
import { emptySyncResult } from "./syncTypes";
import { mergeWorkTypeStrings, normalizeWorkTypeString } from "./workType";
import { cancelReservationsForConfirmedSchedules } from "./reservationAutoCancel";
import { getPrismaClient } from "@/lib/data/prisma";

interface ParsedEngagement {
  rowNumber: number;
  coachName: string;
  coachId: string;
  courseName: string;
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
  workType: string | null;
  hiredByText: string | null;
  status: CoachEngagementStatus;
  schedules: WorkSchedule[];
}

export async function syncContractSheetEngagements(dryRun: boolean): Promise<SyncResult> {
  const { spreadsheetId, range } = readContractSheetConfig();
  const { values: rows, struckCells } = await readGoogleSpreadsheetRows(spreadsheetId, range);
  const result = emptySyncResult(dryRun);
  result.totalRows = Math.max(0, rows.length - 1);

  const prisma = getPrismaClient();
  const coaches = await prisma.coach.findMany({
    where: { deletedAt: null },
    include: { privateProfile: true }
  });
  const coachByName = new Map(coaches.map((coach) => [coach.name, coach]));
  const employeeIdsByName = collectEmployeeIds(rows);
  const parsed: ParsedEngagement[] = [];

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 1;
    const coachName = cell(row, 4);
    const workType = normalizeWorkTypeString(cell(row, 5));
    const manager = cell(row, 6) || null;
    const courseName = cell(row, 7);
    const startDate = parseLooseDate(row[9]);
    const endDate = parseLooseDate(row[10]);
    const cancelText = cell(row, 0);
    const workHoursRaw = row[12];
    const email = normalizeEmail(cell(row, 13));
    const phone = normalizePhone(cell(row, 14));

    if (!coachName || !courseName) {
      result.skipped++;
      continue;
    }
    if (courseName.includes("취소") || cancelText.includes("취소") || struckCells.has(`${index}:7`)) {
      result.skipped++;
      continue;
    }
    if (!startDate || !endDate) {
      result.skipped++;
      result.errorDetail.push(`${rowNumber}행 날짜 누락: ${coachName} / ${courseName}`);
      continue;
    }

    let coach = coachByName.get(coachName);
    if (!coach) {
      if (startDate.getUTCFullYear() < 2026) {
        result.skipped++;
        continue;
      }
      if (dryRun) {
        result.created++;
        result.changes?.push({ coachName, courseName, action: "create_coach", details: "계약 시트 신규 코치" });
        coach = {
          id: `dry-run:${coachName}`,
          name: coachName,
          sourceCoachId: `sheet:${normalizeCoachName(coachName)}`,
          accessToken: null,
          normalizedName: normalizeCoachName(coachName),
          workType,
          status: CoachStatus.ACTIVE,
          statusNote: null,
          returnDate: null,
          selfNote: null,
          portfolioUrl: null,
          availabilityDetail: null,
          managerNote: null,
          dxTag: null,
          notionPageId: null,
          isActive: true,
          displayOrder: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          deletedBy: null,
          privateProfile: null
        };
      } else {
        coach = await prisma.coach.create({
          data: {
            sourceCoachId: `sheet:${normalizeCoachName(coachName)}`,
            accessToken: generateCoachAccessToken(),
            name: coachName,
            normalizedName: normalizeCoachName(coachName),
            workType,
            status: CoachStatus.ACTIVE,
            isActive: true,
            privateProfile: {
              create: {
                employeeId: employeeIdsByName.get(coachName) ?? null,
                email,
                phone,
                affiliation: null,
                birthDate: null
              }
            }
          },
          include: { privateProfile: true }
        });
        result.created++;
      }
      coachByName.set(coachName, coach);
    } else if (!dryRun) {
      await supplementCoachFromSheet(prisma, coach.id, {
        workType,
        employeeId: employeeIdsByName.get(coachName) ?? null,
        email,
        phone
      });
    }

    const schedules = parseWorkSchedules(workHoursRaw, startDate.getUTCFullYear());
    const expandedSchedules = schedules.length > 0 ? schedules : expandWeekdaySchedules(startDate, endDate, workHoursRaw);
    const firstSchedule = expandedSchedules[0] ?? null;

    parsed.push({
      rowNumber,
      coachName,
      coachId: coach.id,
      courseName,
      startDate,
      endDate,
      startTime: firstSchedule?.startTime ?? null,
      endTime: firstSchedule?.endTime ?? null,
      workType,
      hiredByText: manager,
      status: statusFromDates(startDate, endDate),
      schedules: expandedSchedules
    });
  }

  for (const engagement of parsed) {
    if (engagement.coachId.startsWith("dry-run:")) {
      result.created++;
      result.changes?.push({
        coachName: engagement.coachName,
        courseName: engagement.courseName,
        action: "create_engagement",
        details: `스케줄 ${engagement.schedules.length}건`
      });
      continue;
    }

    const sourceEngagementId = sourceId(engagement);
    const existing = await prisma.coachEngagement.findFirst({
      where: {
        OR: [
          { sourceEngagementId },
          {
            coachId: engagement.coachId,
            startDate: { lte: engagement.endDate },
            endDate: { gte: engagement.startDate },
            courseName: engagement.courseName
          }
        ]
      }
    });

    if (dryRun) {
      if (existing) result.updated++;
      else result.created++;
      result.changes?.push({
        coachName: engagement.coachName,
        courseName: engagement.courseName,
        action: existing ? "update_engagement" : "create_engagement",
        details: `스케줄 ${engagement.schedules.length}건`
      });
      continue;
    }

    if (existing) {
      await updateEngagement(prisma, existing.id, sourceEngagementId, engagement);
      result.updated++;
    } else {
      await createEngagement(prisma, sourceEngagementId, engagement);
      result.created++;
    }
  }

  return result;
}

function readContractSheetConfig(): { spreadsheetId: string; range: string } {
  const spreadsheetId = process.env.COACH_CONTRACT_SHEET_ID?.trim() || process.env.GOOGLE_SHEET_ID?.trim() || "";
  const range = process.env.COACH_CONTRACT_SHEET_RANGE?.trim() || "'조교실습코치_일반계약요청'!A:Q";
  if (!spreadsheetId) throw new Error("COACH_CONTRACT_SHEET_ID 또는 GOOGLE_SHEET_ID env가 필요합니다.");
  return { spreadsheetId, range };
}

function collectEmployeeIds(rows: string[][]): Map<string, string> {
  const noise = new Set(["취소", "입사취소", "입사 취소", "계약취소", "근무취소", "사번없음", "-"]);
  const values = new Map<string, Set<string>>();

  for (let index = 1; index < rows.length; index++) {
    const name = cell(rows[index], 4);
    const employeeId = cell(rows[index], 3).replace(/-\d+$/, "").replace(/\(.*?\)/g, "").trim();
    if (!name || !employeeId || noise.has(employeeId)) continue;
    if (!values.has(name)) values.set(name, new Set());
    values.get(name)?.add(employeeId);
  }

  return new Map(Array.from(values.entries()).map(([name, ids]) => [name, Array.from(ids).sort().join(", ")]));
}

async function supplementCoachFromSheet(
  prisma: ReturnType<typeof getPrismaClient>,
  coachId: string,
  values: { workType: string | null; employeeId: string | null; email: string | null; phone: string | null }
) {
  const existing = await prisma.coach.findUnique({ where: { id: coachId }, include: { privateProfile: true } });
  if (!existing) return;

  const mergedWorkType = mergeWorkTypeStrings(existing.workType, values.workType);
  if (mergedWorkType !== existing.workType) {
    await prisma.coach.update({ where: { id: coachId }, data: { workType: mergedWorkType } });
  }

  if (values.employeeId || values.email || values.phone) {
    await prisma.coachPrivateProfile.upsert({
      where: { coachId },
      create: {
        coachId,
        employeeId: values.employeeId,
        email: values.email,
        phone: values.phone,
        birthDate: null,
        affiliation: null
      },
      update: {
        ...(!existing.privateProfile?.employeeId && values.employeeId ? { employeeId: values.employeeId } : {}),
        ...(!existing.privateProfile?.email && values.email ? { email: values.email } : {}),
        ...(!existing.privateProfile?.phone && values.phone ? { phone: values.phone } : {})
      }
    });
  }
}

function statusFromDates(startDate: Date, endDate: Date): CoachEngagementStatus {
  const today = new Date();
  if (endDate < today) return CoachEngagementStatus.COMPLETED;
  if (startDate <= today && endDate >= today) return CoachEngagementStatus.IN_PROGRESS;
  return CoachEngagementStatus.SCHEDULED;
}

function sourceId(engagement: ParsedEngagement): string {
  return `contract-sheet:${engagement.rowNumber}:${engagement.coachName}:${toDateKey(engagement.startDate)}:${toDateKey(engagement.endDate)}`;
}

async function createEngagement(
  prisma: ReturnType<typeof getPrismaClient>,
  sourceEngagementId: string,
  engagement: ParsedEngagement
) {
  await prisma.$transaction(async (tx) => {
    const created = await tx.coachEngagement.create({
      data: {
        sourceEngagementId,
        coachId: engagement.coachId,
        courseName: engagement.courseName,
        status: engagement.status,
        source: CoachEngagementSource.SHEET,
        startDate: engagement.startDate,
        endDate: engagement.endDate,
        startTime: engagement.startTime,
        endTime: engagement.endTime,
        hiredByText: engagement.hiredByText
      }
    });
    await replaceSchedules(tx, created.id, engagement);
  });
}

async function updateEngagement(
  prisma: ReturnType<typeof getPrismaClient>,
  engagementId: string,
  sourceEngagementId: string,
  engagement: ParsedEngagement
) {
  await prisma.$transaction(async (tx) => {
    await tx.coachEngagement.update({
      where: { id: engagementId },
      data: {
        sourceEngagementId,
        courseName: engagement.courseName,
        status: engagement.status,
        source: CoachEngagementSource.SHEET,
        startDate: engagement.startDate,
        endDate: engagement.endDate,
        startTime: engagement.startTime,
        endTime: engagement.endTime,
        hiredByText: engagement.hiredByText
      }
    });
    await tx.coachEngagementSchedule.deleteMany({ where: { engagementId } });
    await replaceSchedules(tx, engagementId, engagement);
  });
}

async function replaceSchedules(tx: Prisma.TransactionClient, engagementId: string, engagement: ParsedEngagement) {
  for (let index = 0; index < engagement.schedules.length; index++) {
    const schedule = engagement.schedules[index];
    await tx.coachEngagementSchedule.create({
      data: {
        sourceEngagementScheduleId: `${sourceId(engagement)}:${index}:${toDateKey(schedule.date)}`,
        engagementId,
        coachId: engagement.coachId,
        date: schedule.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      }
    });
  }

  await cancelReservationsForConfirmedSchedules(
    tx,
    engagement.schedules.map((schedule) => ({ coachId: engagement.coachId, date: schedule.date, engagementId }))
  );
}
