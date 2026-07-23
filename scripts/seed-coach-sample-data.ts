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
const WORK_TYPES = ["프리랜서", "정규직"];

interface CoachDef {
  name: string;
  workType: string;
  status: CoachStatus;
  fields: string[];
  curriculums: string[];
}

const CURATED_COACHES: CoachDef[] = [
  { name: "김도윤", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["프론트엔드"], curriculums: ["React 실무"] },
  { name: "이서연", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["백엔드"], curriculums: ["Python 기초", "SQL 데이터분석"] },
  { name: "박지훈", workType: "정규직", status: CoachStatus.ACTIVE, fields: ["데이터분석"], curriculums: ["SQL 데이터분석"] },
  { name: "최유진", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["UX/UI"], curriculums: ["Figma 실전"] },
  { name: "정민준", workType: "프리랜서", status: CoachStatus.ACTIVE, fields: ["AI/ML"], curriculums: ["LLM 애플리케이션"] },
  { name: "강하은", workType: "정규직", status: CoachStatus.ACTIVE, fields: ["프론트엔드", "UX/UI"], curriculums: ["React 실무", "Figma 실전"] },
  { name: "윤서준", workType: "프리랜서", status: CoachStatus.INACTIVE, fields: ["백엔드"], curriculums: ["Python 기초"] },
  { name: "임채원", workType: "프리랜서", status: CoachStatus.PENDING, fields: ["AI/ML"], curriculums: ["LLM 애플리케이션"] }
];

// 실사용에 가까운 수의 코치로 화면을 확인할 수 있도록, 위 8명 외에 이름을 조합해 더 생성한다.
const GENERATED_COACH_COUNT = 42;

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "전", "홍"];
const GIVEN_FIRST = ["도", "서", "지", "유", "민", "하", "시", "은", "준", "우", "현", "수", "진", "재", "성", "혜", "아", "건", "태", "율"];
const GIVEN_SECOND = ["윤", "연", "훈", "진", "준", "은", "우", "린", "현", "아", "빈", "호", "경", "완", "규", "솔", "람", "결", "찬", "영"];

// 재실행해도 같은 결과가 나오도록 고정 시드 PRNG를 사용한다.
function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function pickMany<T>(rng: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const result: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

function generateCoaches(count: number): CoachDef[] {
  const rng = createRng(20260723);
  const usedNames = new Set(CURATED_COACHES.map((c) => c.name));
  const generated: CoachDef[] = [];

  while (generated.length < count) {
    const name = `${pick(rng, SURNAMES)}${pick(rng, GIVEN_FIRST)}${pick(rng, GIVEN_SECOND)}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);

    const statusRoll = rng();
    const status = statusRoll < 0.85 ? CoachStatus.ACTIVE : statusRoll < 0.95 ? CoachStatus.PENDING : CoachStatus.INACTIVE;
    const fields = pickMany(rng, FIELDS, 1 + Math.floor(rng() * 2));
    const curriculums = pickMany(rng, CURRICULUMS, 1 + Math.floor(rng() * 2));

    generated.push({
      name,
      workType: pick(rng, WORK_TYPES),
      status,
      fields,
      curriculums
    });
  }

  return generated;
}

const COACHES: CoachDef[] = [...CURATED_COACHES, ...generateCoaches(GENERATED_COACH_COUNT)];

const TIME_BLOCKS = [
  { startTime: "09:00", endTime: "12:00" }, // 오전
  { startTime: "13:00", endTime: "18:00" }, // 오후
  { startTime: "19:00", endTime: "21:00" }, // 저녁
  { startTime: "10:00", endTime: "18:00" } // 종일
] as const;

function ymd(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

// 코치 일정 화면에서 달 이동/다중 선택을 확인할 수 있도록 7월(이번 달)과 8월(다음 달) 모두 시드한다.
const SEED_MONTHS = [7, 8];

function pickScheduleDays(rng: () => number, count: number): number[] {
  const allDays = Array.from({ length: 28 }, (_, i) => i + 1);
  return pickMany(rng, allDays, count).sort((a, b) => a - b);
}

async function main(): Promise<void> {
  console.log("[seed-coach-sample-data] 샘플 데이터 생성 시작");

  // sourceScheduleId 형식이 바뀌었으므로(코치-일 -> 코치-월-일), 이전 형식으로 남은 샘플 일정을 먼저 정리한다.
  const { count: removedCount } = await prisma.coachSchedule.deleteMany({
    where: { sourceScheduleId: { startsWith: "seed-schedule-" } }
  });
  if (removedCount > 0) {
    console.log(`[seed-coach-sample-data] 기존 샘플 일정 ${removedCount}건 정리`);
  }

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

    // 이번 달·다음 달에 코치별로 랜덤한 날짜·시간대 일정 배정 (달 이동/다중 선택 확인용)
    const scheduleRng = createRng(20260723 + index * 97);
    for (const month of SEED_MONTHS) {
      const dayCount = 5 + Math.floor(scheduleRng() * 6); // 5~10일
      const days = pickScheduleDays(scheduleRng, dayCount);
      for (const day of days) {
        const block = pick(scheduleRng, TIME_BLOCKS);
        const sourceScheduleId = `seed-schedule-${index + 1}-${month}-${day}`;
        await prisma.coachSchedule.upsert({
          where: { sourceScheduleId },
          create: {
            sourceScheduleId,
            coachId: coach.id,
            date: ymd(2026, month, day),
            startTime: block.startTime,
            endTime: block.endTime
          },
          update: {
            date: ymd(2026, month, day),
            startTime: block.startTime,
            endTime: block.endTime
          }
        });
        scheduleCount += 1;
      }
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
