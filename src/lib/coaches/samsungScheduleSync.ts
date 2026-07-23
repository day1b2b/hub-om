import { CoachEngagementSource, CoachEngagementStatus, CoachStatus } from "@prisma/client";
import { generateCoachAccessToken, normalizeCoachName } from "./accessToken";
import { expandDateRange, parseLooseDate, toDateKey } from "./dateParse";
import { readGoogleSheetValues } from "./googleServiceAccount";
import { cell, normalizeEmail, normalizePhone } from "./sheetParsers";
import type { SyncResult } from "./syncTypes";
import { emptySyncResult } from "./syncTypes";
import { mergeWorkTypeStrings, normalizeWorkTypeString } from "./workType";
import { cancelReservationsForConfirmedSchedules } from "./reservationAutoCancel";
import { getPrismaClient } from "@/lib/data/prisma";

const DEFAULT_SAMSUNG_SHEET_ID = "1GWF3v9lLpS0SlM45QGAHmj2k2N1U2AX8zB8DOMlXHr0";
const DEFAULT_CONTRACT_SHEET_ID = "1xFgbLPL1ZLGxQws0ofK0kU8eehrFqEeAiwNbtQ56lyw";
const COURSE_NAME = "(B2B) 삼성전자 SW학부 교육과정_26년";
const OLD_COURSE_NAME = "삼성전자 SW학부 교육과정";

interface ContractInfo {
  workType: string | null;
  hiredByText: string | null;
  employeeId: string | null;
  email: string | null;
  phone: string | null;
}

interface SamsungEntry {
  coachName: string;
  coachId: string;
  startDate: Date;
  endDate: Date;
  hiredByText: string | null;
}

export async function syncSamsungSchedule(dryRun: boolean): Promise<SyncResult> {
  const config = readSamsungConfig();
  const rows = await readGoogleSheetValues(config.scheduleSheetId, config.scheduleRange);
  const contracts = await readContractInfo(config);
  const result = emptySyncResult(dryRun);
  result.totalRows = Math.max(0, rows.length - 1);

  const prisma = getPrismaClient();
  const coaches = await prisma.coach.findMany({ where: { deletedAt: null }, include: { privateProfile: true } });
  const coachByName = new Map(coaches.map((coach) => [coach.name, coach]));
  const entries: SamsungEntry[] = [];

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const startDate = parseLooseDate(row[2]);
    const endDate = parseLooseDate(row[3]) ?? startDate;
    const coachNames = cell(row, 6).split(/[/／,]/).map((name) => name.trim()).filter(Boolean);

    if (!startDate || !endDate || coachNames.length === 0) {
      result.skipped++;
      continue;
    }

    for (const coachName of coachNames) {
      const contract = contracts.get(coachName);
      let coach = coachByName.get(coachName);
      if (!coach) {
        if (dryRun) {
          result.created++;
          result.changes?.push({ coachName, courseName: COURSE_NAME, action: "create_coach", details: "삼성 일정 신규 코치" });
          coach = {
            id: `dry-run:${coachName}`,
            sourceCoachId: `samsung:${normalizeCoachName(coachName)}`,
            accessToken: null,
            name: coachName,
            normalizedName: normalizeCoachName(coachName),
            workType: mergeWorkTypeStrings("삼전 DS", contract?.workType),
            status: CoachStatus.ACTIVE,
            statusNote: null,
            returnDate: null,
            selfNote: null,
            portfolioUrl: null,
            availabilityDetail: null,
            managerNote: null,
            dxTag: "DS",
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
              sourceCoachId: `samsung:${normalizeCoachName(coachName)}`,
              accessToken: generateCoachAccessToken(),
              name: coachName,
              normalizedName: normalizeCoachName(coachName),
              workType: mergeWorkTypeStrings("삼전 DS", contract?.workType),
              status: CoachStatus.ACTIVE,
              isActive: true,
              dxTag: "DS",
              privateProfile: {
                create: {
                  employeeId: contract?.employeeId ?? null,
                  email: contract?.email ?? null,
                  phone: contract?.phone ?? null,
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
        await supplementSamsungCoach(prisma, coach.id, coach.workType, coach.privateProfile, contract);
      }

      entries.push({
        coachName,
        coachId: coach.id,
        startDate,
        endDate,
        hiredByText: contract?.hiredByText ?? null
      });
    }
  }

  if (dryRun) {
    result.created += entries.length;
    result.changes?.push({ coachName: "삼성 일정", courseName: COURSE_NAME, action: "replace_samsung_engagements", details: `재생성 대상 ${entries.length}건` });
    return result;
  }

  await prisma.$transaction(async (tx) => {
    await tx.coachEngagementSchedule.deleteMany({
      where: { engagement: { courseName: { in: [COURSE_NAME, OLD_COURSE_NAME] } } }
    });
    await tx.coachEngagement.deleteMany({
      where: { courseName: { in: [COURSE_NAME, OLD_COURSE_NAME] } }
    });

    const confirmedSchedules: Array<{ coachId: string; date: Date; engagementId: string }> = [];

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const created = await tx.coachEngagement.create({
        data: {
          sourceEngagementId: `samsung:${index}:${entry.coachName}:${toDateKey(entry.startDate)}:${toDateKey(entry.endDate)}`,
          coachId: entry.coachId,
          courseName: COURSE_NAME,
          status: statusFromDates(entry.startDate, entry.endDate),
          source: CoachEngagementSource.SHEET,
          startDate: entry.startDate,
          endDate: entry.endDate,
          startTime: "09:00",
          endTime: "18:00",
          hiredByText: entry.hiredByText
        }
      });

      const dates = expandDateRange(entry.startDate, entry.endDate);
      for (let dateIndex = 0; dateIndex < dates.length; dateIndex++) {
        const date = dates[dateIndex];
        await tx.coachEngagementSchedule.create({
          data: {
            sourceEngagementScheduleId: `samsung:${index}:${dateIndex}:${entry.coachName}:${toDateKey(date)}`,
            engagementId: created.id,
            coachId: entry.coachId,
            date,
            startTime: "09:00",
            endTime: "18:00"
          }
        });
        confirmedSchedules.push({ coachId: entry.coachId, date, engagementId: created.id });
      }
      result.created++;
    }

    await cancelReservationsForConfirmedSchedules(tx, confirmedSchedules);
  }, { timeout: 60000 });

  return result;
}

function readSamsungConfig() {
  return {
    scheduleSheetId: process.env.SAMSUNG_SCHEDULE_SHEET_ID?.trim() || DEFAULT_SAMSUNG_SHEET_ID,
    scheduleRange: process.env.SAMSUNG_SCHEDULE_SHEET_RANGE?.trim() || "'26년 일정'!A:J",
    contractSheetId: process.env.SAMSUNG_CONTRACT_SHEET_ID?.trim() || process.env.COACH_CONTRACT_SHEET_ID?.trim() || DEFAULT_CONTRACT_SHEET_ID,
    contractRange: process.env.SAMSUNG_CONTRACT_SHEET_RANGE?.trim() || "'운영조교/실습코치 계약요청'!A:Q"
  };
}

async function readContractInfo(config: ReturnType<typeof readSamsungConfig>): Promise<Map<string, ContractInfo>> {
  const byName = new Map<string, ContractInfo>();
  try {
    const rows = await readGoogleSheetValues(config.contractSheetId, config.contractRange);
    for (let index = 2; index < rows.length; index++) {
      const row = rows[index];
      const name = cell(row, 5);
      if (!name) continue;
      byName.set(name, {
        employeeId: cell(row, 4) || null,
        workType: normalizeWorkTypeString(cell(row, 6)),
        hiredByText: cell(row, 7) || null,
        email: normalizeEmail(cell(row, 14)),
        phone: normalizePhone(cell(row, 15))
      });
    }
  } catch {
    return byName;
  }
  return byName;
}

async function supplementSamsungCoach(
  prisma: ReturnType<typeof getPrismaClient>,
  coachId: string,
  currentWorkType: string | null,
  currentPrivateProfile: { employeeId: string | null; email: string | null; phone: string | null } | null,
  contract: ContractInfo | undefined
) {
  const nextWorkType = mergeWorkTypeStrings(currentWorkType, "삼전 DS", contract?.workType);
  await prisma.coach.update({ where: { id: coachId }, data: { workType: nextWorkType, dxTag: "DS" } });

  if (contract?.employeeId || contract?.email || contract?.phone) {
    await prisma.coachPrivateProfile.upsert({
      where: { coachId },
      create: {
        coachId,
        employeeId: contract.employeeId,
        email: contract.email,
        phone: contract.phone,
        affiliation: null,
        birthDate: null
      },
      update: {
        ...(!currentPrivateProfile?.employeeId && contract.employeeId ? { employeeId: contract.employeeId } : {}),
        ...(!currentPrivateProfile?.email && contract.email ? { email: contract.email } : {}),
        ...(!currentPrivateProfile?.phone && contract.phone ? { phone: contract.phone } : {})
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
