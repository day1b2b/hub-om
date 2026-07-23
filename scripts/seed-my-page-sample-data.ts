/**
 * 로컬 개발용 마이페이지 "지난 과정" 샘플 데이터 시드.
 *
 * 특정 매니저 이메일로 예약 → 확정 흐름을 거친 것처럼 보이도록,
 * 이미 취소(confirmedEngagementId 세팅)된 예약 + 확정 과정(CoachEngagement)
 * + 회차(CoachEngagementSchedule)를 함께 만든다. 실제 PII 없음(전부 가짜 데이터).
 *
 * 실행:
 *   node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
 *     scripts/seed-my-page-sample-data.ts
 */

import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, CoachEngagementSource, CoachEngagementStatus } from "@prisma/client";

config({ path: ".env.local" });
config({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[seed-my-page-sample-data] DATABASE_URL이 없어 종료합니다.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

const MY_EMAIL = process.env.SEED_MY_PAGE_EMAIL || "hyeonjeong.lee@day1company.co.kr";
const MY_NAME = "이현정";

function ymd(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function dateRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

interface SeedCourse {
  courseName: string;
  coaches: Array<{
    sourceCoachId: string;
    startDate: Date;
    endDate: Date;
    rating: number | null;
    feedback: string | null;
    rehire: boolean | null;
  }>;
}

const COURSES: SeedCourse[] = [
  {
    courseName: "[부가세 별도] (B2B) AI 리더십 워크숍",
    coaches: [
      {
        sourceCoachId: "seed-coach-1",
        startDate: ymd(2026, 6, 15),
        endDate: ymd(2026, 6, 15),
        rating: 5,
        feedback: "현장 대응이 훌륭했어요",
        rehire: true
      }
    ]
  },
  {
    courseName: "[부가세 별도] (B2B) 데이터 분석 부트캠프",
    coaches: [
      {
        sourceCoachId: "seed-coach-2",
        startDate: ymd(2026, 6, 8),
        endDate: ymd(2026, 6, 10),
        rating: null,
        feedback: null,
        rehire: null
      },
      {
        sourceCoachId: "seed-coach-3",
        startDate: ymd(2026, 6, 22),
        endDate: ymd(2026, 6, 23),
        rating: null,
        feedback: null,
        rehire: null
      }
    ]
  }
];

async function main(): Promise<void> {
  console.log(`[seed-my-page-sample-data] ${MY_EMAIL} 기준 샘플 데이터 생성 시작`);

  // 재실행 시 중복 생성되지 않도록 이전 샘플을 먼저 정리한다.
  const oldEngagements = await prisma.coachEngagement.findMany({
    where: { sourceEngagementId: { startsWith: "seed-mypage:" } },
    select: { id: true }
  });
  const oldEngagementIds = oldEngagements.map((e) => e.id);
  if (oldEngagementIds.length > 0) {
    await prisma.coachDayReservation.deleteMany({ where: { confirmedEngagementId: { in: oldEngagementIds } } });
    await prisma.coachEngagementSchedule.deleteMany({ where: { engagementId: { in: oldEngagementIds } } });
    await prisma.coachEngagement.deleteMany({ where: { id: { in: oldEngagementIds } } });
  }

  let courseCount = 0;
  let coachCount = 0;

  for (const course of COURSES) {
    courseCount += 1;
    for (const def of course.coaches) {
      const coach = await prisma.coach.findFirst({ where: { sourceCoachId: def.sourceCoachId } });
      if (!coach) {
        console.warn(`[seed-my-page-sample-data] 코치를 찾을 수 없음: ${def.sourceCoachId} (먼저 db:seed:coach-sample을 실행하세요)`);
        continue;
      }

      const engagement = await prisma.coachEngagement.create({
        data: {
          sourceEngagementId: `seed-mypage:${course.courseName}:${def.sourceCoachId}`,
          coachId: coach.id,
          courseName: course.courseName,
          status: CoachEngagementStatus.COMPLETED,
          source: CoachEngagementSource.MANUAL,
          startDate: def.startDate,
          endDate: def.endDate,
          startTime: "10:00",
          endTime: "18:00",
          rating: def.rating,
          feedback: def.feedback,
          rehire: def.rehire
        }
      });

      const days = dateRange(def.startDate, def.endDate).filter((d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5);
      for (const day of days) {
        await prisma.coachEngagementSchedule.create({
          data: {
            sourceEngagementScheduleId: `seed-mypage-schedule:${engagement.id}:${day.toISOString().slice(0, 10)}`,
            engagementId: engagement.id,
            coachId: coach.id,
            date: day,
            startTime: "10:00",
            endTime: "18:00"
          }
        });
      }

      // 예약 -> 확정 흐름을 거친 것처럼, 이미 취소된 상태로 만든다.
      await prisma.coachDayReservation.create({
        data: {
          coachId: coach.id,
          date: def.startDate,
          reservedByName: MY_NAME,
          reservedByEmail: MY_EMAIL,
          createdAt: new Date(def.startDate.getTime() - 7 * 24 * 60 * 60 * 1000),
          cancelledAt: def.startDate,
          confirmedEngagementId: engagement.id
        }
      });

      coachCount += 1;
    }
  }

  console.log(`[seed-my-page-sample-data] 완료: 과정 ${courseCount}건 / 코치-투입 ${coachCount}건`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
