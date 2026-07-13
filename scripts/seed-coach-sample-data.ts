/**
 * 로컬 개발용 실습코치 샘플 데이터 시드.
 *
 * coach-db(원본 소스)에 네트워크로 접근할 수 없는 로컬 환경에서
 * 코치 일정 화면을 눈으로 확인하기 위한 용도. 실제 PII 없음(전부 가짜 데이터).
 *
 * 실행:
 *   node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
 *     scripts/seed-coach-sample-data.ts
 */

import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, CoachStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";

config({ path: ".env.local" });
config({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[seed-coach-sample-data] DATABASE_URL이 없어 종료합니다.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function accessToken(): string {
  return randomBytes(32).toString("hex");
}

const FIELDS = ["프론트엔드", "백엔드", "데이터분석", "UX/UI", "AI/ML"];
const CURRICULUMS = ["React 실무", "Python 기초", "SQL 데이터분석", "Figma 실전", "LLM 애플리케이션"];

const COACHES: Array<{
  name: string;
  workType: string;
  status: CoachStatus;
  fields: string[];
  curriculums: string[];
}> = [
  { name: "김도윤", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["프론트엔드"], curriculums: ["React 실무"] },
  { name: "이서연", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["백엔드"], curriculums: ["Python 기초", "SQL 데이터분석"] },
  { name: "박지훈", workType: "정규직", status: CoachStatus.ACTIVE, fields: ["데이터분석"], curriculums: ["SQL 데이터분석"] },
  { name: "최유진", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["UX/UI"], curriculums: ["Figma 실전"] },
  { name: "정민준", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["AI/ML"], curriculums: ["LLM 애플리케이션"] },
  { name: "강하은", workType: "정규직", status: CoachStatus.ACTIVE, fields: ["프론트엔드", "UX/UI"], curriculums: ["React 실무", "Figma 실전"] },
  { name: "윤서준", workType: "프리랜서", status: CoachStatus.INACTIVE, fields: ["백엔드"], curriculums: ["Python 기초"] },
  { name: "임채원", workType: "프리랜서", status: CoachStatus.PENDING, fields: ["AI/ML"], curriculums: ["LLM 애플리케이션"] }
];

function ymd(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

async function main(): Promise<void> {
  console.log("[seed-coach-sample-data] 샘플 데이터 생성 시작");

  const fieldMasterMap = new Map<string, string>();
  for (const name of FIELDS) {
    const master = await prisma.coachFieldMaster.upsert({
      where: { name },
      create: { name },
      update: {}
    });
    fieldMasterMap.set(name, master.id);
  }

  const curriculumMasterMap = new Map<string, string>();
  for (const name of CURRICULUMS) {
    const master = await prisma.coachCurriculumMaster.upsert({
      where: { name },
      create: { name },
      update: {}
    });
    curriculumMasterMap.set(name, master.id);
  }

  let coachCount = 0;
  let scheduleCount = 0;

  for (const [index, def] of COACHES.entries()) {
    const sourceCoachId = `seed-coach-${index + 1}`;
    const coach = await prisma.coach.upsert({
      where: { sourceCoachId },
      create: {
        sourceCoachId,
        accessToken: accessToken(),
        name: def.name,
        normalizedName: normalizeName(def.name),
        workType: def.workType,
        status: def.status,
        isActive: true
      },
      update: {
        name: def.name,
        normalizedName: normalizeName(def.name),
        workType: def.workType,
        status: def.status
      }
    });
    coachCount += 1;

    for (const fieldName of def.fields) {
      const tagId = fieldMasterMap.get(fieldName);
      if (!tagId) continue;
      await prisma.coachField.upsert({
        where: { coachId_tagId: { coachId: coach.id, tagId } },
        create: { coachId: coach.id, tagId },
        update: {}
      });
    }

    for (const curriculumName of def.curriculums) {
      const tagId = curriculumMasterMap.get(curriculumName);
      if (!tagId) continue;
      await prisma.coachCurriculum.upsert({
        where: { coachId_tagId: { coachId: coach.id, tagId } },
        create: { coachId: coach.id, tagId },
        update: {}
      });
    }

    // 이번 달 몇 개 날짜에 일정 배정 (코치별로 살짝 다르게)
    const days = [3 + index, 10 + index, 17 + index].filter((d) => d <= 28);
    for (const day of days) {
      const sourceScheduleId = `seed-schedule-${index + 1}-${day}`;
      await prisma.coachSchedule.upsert({
        where: { sourceScheduleId },
        create: {
          sourceScheduleId,
          coachId: coach.id,
          date: ymd(2026, 7, day),
          startTime: "10:00",
          endTime: "18:00"
        },
        update: {
          date: ymd(2026, 7, day),
          startTime: "10:00",
          endTime: "18:00"
        }
      });
      scheduleCount += 1;
    }
  }

  console.log(`[seed-coach-sample-data] 완료: 코치 ${coachCount}명 / 일정 ${scheduleCount}건`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
