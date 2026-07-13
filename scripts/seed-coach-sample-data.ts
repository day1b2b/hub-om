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
import { PrismaClient, CoachStatus, CoachEngagementStatus, CoachEngagementSource } from "@prisma/client";
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

const PERIODS = [
  { start: "08:00", end: "12:00" },
  { start: "13:00", end: "18:00" },
  { start: "19:00", end: "22:00" }
] as const;

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
  { name: "임채원", workType: "프리랜서", status: CoachStatus.PENDING, fields: ["AI/ML"], curriculums: ["LLM 애플리케이션"] },
  { name: "한소율", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["프론트엔드", "AI/ML"], curriculums: ["React 실무", "LLM 애플리케이션"] },
  { name: "오지호", workType: "정규직", status: CoachStatus.ACTIVE, fields: ["백엔드", "데이터분석"], curriculums: ["Python 기초", "SQL 데이터분석"] },
  { name: "배수아", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["UX/UI"], curriculums: ["Figma 실전"] },
  { name: "신동현", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["프론트엔드"], curriculums: ["React 실무"] },
  { name: "조아름", workType: "정규직", status: CoachStatus.ACTIVE, fields: ["데이터분석", "AI/ML"], curriculums: ["SQL 데이터분석", "LLM 애플리케이션"] },
  { name: "장현우", workType: "프리랜서", status: CoachStatus.INACTIVE, fields: ["UX/UI", "프론트엔드"], curriculums: ["Figma 실전", "React 실무"] }
];

// 코치별 투입 건수 샘플 (정렬 확인용 — 코치 순서와 매칭됨). 값이 클수록 목록 상단에 노출.
const ENGAGEMENT_COUNTS = [5, 2, 4, 0, 3, 6, 1, 0, 3, 5, 2, 1, 4, 0];

const ENGAGEMENT_COURSE_NAMES = [
  "React 실무 기초",
  "Python 데이터분석 입문",
  "SQL 데이터분석 심화",
  "Figma UX 실전",
  "LLM 애플리케이션 구축"
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

  // 기존 시드 일정/투입이력을 지우고 다시 채운다 (재실행해도 낡은 데이터가 남지 않도록)
  await prisma.coachSchedule.deleteMany({ where: { sourceScheduleId: { startsWith: "seed-schedule-" } } });
  await prisma.coachEngagement.deleteMany({ where: { sourceEngagementId: { startsWith: "seed-engagement-" } } });

  let coachCount = 0;
  let scheduleCount = 0;
  let engagementCount = 0;

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

    // 이번 달 여러 날짜에 일정 배정 (코치별로 살짝 다르게, 오전/오후/저녁을 돌아가며 배정)
    // 3일 간격으로 최대 8개 날짜, 3번째 날마다 하루에 2개 시간대(예: 오전+저녁)를 배정해 데이터를 풍부하게 만든다.
    const days = Array.from({ length: 8 }, (_, i) => 2 + index + i * 3).filter((d) => d <= 28);
    for (const [dayIndex, day] of days.entries()) {
      const primary = PERIODS[(index + dayIndex) % PERIODS.length];
      const periodsForDay = [primary];
      if (dayIndex % 3 === 2) {
        const extra = PERIODS[(index + dayIndex + 1) % PERIODS.length];
        periodsForDay.push(extra);
      }

      for (const [slotIndex, period] of periodsForDay.entries()) {
        const sourceScheduleId = `seed-schedule-${index + 1}-${day}-${slotIndex}`;
        await prisma.coachSchedule.upsert({
          where: { sourceScheduleId },
          create: {
            sourceScheduleId,
            coachId: coach.id,
            date: ymd(2026, 7, day),
            startTime: period.start,
            endTime: period.end
          },
          update: {
            date: ymd(2026, 7, day),
            startTime: period.start,
            endTime: period.end
          }
        });
        scheduleCount += 1;
      }
    }

    // 투입 이력 샘플 (코치별 건수는 ENGAGEMENT_COUNTS 참고, 정렬 확인용)
    const targetEngagementCount = ENGAGEMENT_COUNTS[index] ?? 0;
    for (let e = 0; e < targetEngagementCount; e += 1) {
      const sourceEngagementId = `seed-engagement-${index + 1}-${e}`;
      const courseName = ENGAGEMENT_COURSE_NAMES[(index + e) % ENGAGEMENT_COURSE_NAMES.length];
      const month = 4 + (e % 3); // 4~6월 중 분산
      const startDate = ymd(2026, month, 10);
      const endDate = ymd(2026, month, 12);
      await prisma.coachEngagement.upsert({
        where: { sourceEngagementId },
        create: {
          sourceEngagementId,
          coachId: coach.id,
          courseName,
          status: CoachEngagementStatus.COMPLETED,
          source: CoachEngagementSource.MANUAL,
          startDate,
          endDate
        },
        update: {
          courseName,
          startDate,
          endDate
        }
      });
      engagementCount += 1;
    }
  }

  console.log(
    `[seed-coach-sample-data] 완료: 코치 ${coachCount}명 / 일정 ${scheduleCount}건 / 투입이력 ${engagementCount}건`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
