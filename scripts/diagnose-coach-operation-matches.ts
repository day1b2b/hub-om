/**
 * coach_engagements 미매칭 건의 운영 세션 후보를 진단한다.
 *
 * 실행:
 *   npm run db:diagnose:coach-operation-matches
 *   npm run db:diagnose:coach-operation-matches -- --limit=50
 */

import { config } from "dotenv";
import pg from "pg";
import {
  rankOperationCandidates,
  type OperationCandidate,
  type ScheduleTimeRange
} from "../src/lib/data/operationMatch/matchOperation.ts";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

interface CoachEngagementRow {
  id: string;
  course_name: string;
  coach_name: string | null;
  start_date: unknown;
  end_date: unknown;
  start_time: string | null;
  end_time: string | null;
  schedule_dates: string[] | null;
  schedule_time_ranges: string[] | null;
}

function parseLimit(args: string[]): number {
  const arg = args.find((value) => value.startsWith("--limit="));
  const parsed = Number(arg?.slice("--limit=".length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
}

function dateOnly(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? match[0] : "";
}

async function main(): Promise<void> {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) {
    console.error("[diagnose-coach-operation-matches] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  const limit = parseLimit(process.argv.slice(2));
  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  try {
    const counts = await loadCounts(client);
    const candidates = await loadOperationCandidates(client);
    const engagements = await loadUnmatchedCoachEngagements(client);

    console.log(
      `[diagnose-coach-operation-matches] 전체 ${counts.total}건 / 연결 ${counts.matched}건 / 미연결 ${counts.unmatched}건`
    );

    console.log("\n[미연결 course_name 상위]");
    console.table(topCourseNames(engagements, 15));

    console.log(`\n[미연결 후보 상위 ${limit}건]`);
    console.table(
      engagements.slice(0, limit).map((engagement) => {
        const ranked = rankOperationCandidates(
          {
            courseName: engagement.course_name,
            coachName: engagement.coach_name,
            startDate: dateOnly(engagement.start_date),
            endDate: dateOnly(engagement.end_date),
            startTime: engagement.start_time,
            endTime: engagement.end_time,
            scheduleDates: engagement.schedule_dates ?? [],
            scheduleTimes: parseScheduleTimeRanges(engagement.schedule_time_ranges)
          },
          candidates
        );
        const best = ranked.find((candidate) => candidate.score > 0);
        const nearestDateOnly = ranked.find(
          (candidate) => candidate.score === 0 && candidate.dateScore > 0 && candidate.courseScore === 0
        );
        return {
          engagement: engagement.course_name,
          coach: engagement.coach_name ?? "",
          dates: `${dateOnly(engagement.start_date)}~${dateOnly(engagement.end_date)}`,
          schedules: (engagement.schedule_dates ?? []).join(","),
          bestOperation: best?.candidate.operationId ?? "",
          bestCompany: best?.candidate.companyName ?? "",
          bestCourse: best?.candidate.courseName ?? "",
          bestDates: best ? `${best.candidate.startDate}~${best.candidate.endDate}` : "",
          score: best?.score ?? 0,
          courseScore: best?.courseScore ?? 0,
          dateScore: best?.dateScore ?? 0,
          timeScore: best?.timeScore ?? 0,
          coachScore: best?.coachScore ?? 0,
          dateOnlyCandidate: nearestDateOnly
            ? `${nearestDateOnly.candidate.companyName ?? ""} / ${nearestDateOnly.candidate.courseName}`
            : ""
        };
      })
    );
  } finally {
    await client.end();
  }
}

async function loadCounts(client: pg.Client): Promise<{ total: number; matched: number; unmatched: number }> {
  const result = await client.query<{ total: number; matched: number; unmatched: number }>(
    `SELECT count(*)::int AS total,
            count(operation_session_id)::int AS matched,
            count(*) FILTER (WHERE operation_session_id IS NULL)::int AS unmatched
     FROM coach_engagements`
  );

  return result.rows[0];
}

async function loadOperationCandidates(client: pg.Client): Promise<OperationCandidate[]> {
  const result = await client.query<{
    id: string;
    operation_id: string | null;
    company_name: string | null;
    course_name: string;
    start_date: unknown;
    end_date: unknown;
    time_text: string | null;
    coach_text: string | null;
    instructors_text: string | null;
  }>(
    `SELECT os.id, os.operation_id, companies.name AS company_name, c.course_name AS course_name,
            os.start_date, os.end_date, os.time_text, os.coach_text, os.instructors_text
     FROM operation_sessions os
     JOIN courses c ON os.course_record_id = c.id
     JOIN companies ON c.company_id = companies.id
     WHERE os.deleted_at IS NULL`
  );

  return result.rows.map((row) => ({
    id: row.id,
    operationId: row.operation_id,
    companyName: row.company_name,
    courseName: row.course_name ?? "",
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    timeText: row.time_text,
    coachText: row.coach_text,
    instructorsText: row.instructors_text
  }));
}

async function loadUnmatchedCoachEngagements(client: pg.Client): Promise<CoachEngagementRow[]> {
  const result = await client.query<CoachEngagementRow>(
    `SELECT ce.id, ce.course_name, coaches.name AS coach_name,
            ce.start_date, ce.end_date, ce.start_time, ce.end_time,
            array_remove(array_agg(DISTINCT ces.date::text ORDER BY ces.date::text), NULL) AS schedule_dates,
            array_remove(
              array_agg(DISTINCT (ces.start_time || '-' || ces.end_time) ORDER BY (ces.start_time || '-' || ces.end_time)),
              NULL
            ) AS schedule_time_ranges
     FROM coach_engagements ce
     JOIN coaches ON ce.coach_id = coaches.id
     LEFT JOIN coach_engagement_schedules ces
       ON ces.engagement_id = ce.id
      AND ces.cancelled_at IS NULL
     WHERE ce.operation_session_id IS NULL
     GROUP BY ce.id, coaches.name
     ORDER BY ce.start_date DESC, ce.course_name ASC`
  );

  return result.rows;
}

function topCourseNames(rows: CoachEngagementRow[], limit: number): Array<{ courseName: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.course_name, (counts.get(row.course_name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([courseName, count]) => ({ courseName, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

function parseScheduleTimeRanges(values: string[] | null | undefined): ScheduleTimeRange[] {
  return (values ?? [])
    .map((value) => {
      const [startTime, endTime] = value.split("-");
      if (!startTime || !endTime) return null;
      return { startTime, endTime };
    })
    .filter((value): value is ScheduleTimeRange => value !== null);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
