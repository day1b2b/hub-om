/**
 * 이미 import된 coach_engagements의 operation_session_id를 hub-om DB 안에서 백필한다.
 *
 * 실행:
 *   npm run db:backfill:coach-operation-matches -- --dry-run
 *   npm run db:backfill:coach-operation-matches -- --apply
 *
 * COACH_DB_DATABASE_URL은 사용하지 않는다. import 이후 소스 DB 접속 env를 제거한 상태에서도 실행 가능하다.
 */

import { config } from "dotenv";
import pg from "pg";
import {
  matchOperation,
  type OperationCandidate,
  type ScheduleTimeRange
} from "../src/lib/data/coachImport/matchOperation.ts";

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

interface Summary {
  checked: number;
  matched: number;
  unmatched: number;
  updated: number;
}

function parseOptions(args: string[]): { apply: boolean } {
  return { apply: args.includes("--apply") };
}

function dateOnly(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? match[0] : "";
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const targetUrl = process.env.DATABASE_URL;

  if (!targetUrl) {
    console.error("[backfill-coach-operation-matches] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  console.log(
    `[backfill-coach-operation-matches] 모드: ${options.apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`
  );

  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  try {
    const candidates = await loadOperationCandidates(client);
    const engagements = await loadUnmatchedCoachEngagements(client);
    const summary: Summary = { checked: engagements.length, matched: 0, unmatched: 0, updated: 0 };

    const matches = engagements
      .map((engagement) => ({
        engagementId: engagement.id,
        operationSessionId: matchOperation(
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
        )
      }))
      .filter((match) => {
        if (match.operationSessionId) {
          summary.matched += 1;
          return true;
        }
        summary.unmatched += 1;
        return false;
      });

    if (options.apply && matches.length > 0) {
      await client.query("BEGIN");
      try {
        for (const match of matches) {
          await client.query(
            `UPDATE coach_engagements
             SET operation_session_id = $1
             WHERE id = $2 AND operation_session_id IS NULL`,
            [match.operationSessionId, match.engagementId]
          );
          summary.updated += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log(
      `[backfill-coach-operation-matches] ${options.apply ? "apply" : "dry-run"} 완료: ` +
        `검사 ${summary.checked}건 / 매칭 ${summary.matched}건 / 미매칭 ${summary.unmatched}건 / 업데이트 ${summary.updated}건`
    );
  } finally {
    await client.end();
  }
}

async function loadOperationCandidates(client: pg.Client): Promise<OperationCandidate[]> {
  const result = await client.query<{
    id: string;
    company_name: string | null;
    course_name: string;
    start_date: unknown;
    end_date: unknown;
    time_text: string | null;
    coach_text: string | null;
    instructors_text: string | null;
  }>(
    `SELECT os.id, companies.name AS company_name, c.course_name AS course_name,
            os.start_date, os.end_date, os.time_text, os.coach_text, os.instructors_text
     FROM operation_sessions os
     JOIN courses c ON os.course_record_id = c.id
     JOIN companies ON c.company_id = companies.id
     WHERE os.deleted_at IS NULL`
  );

  return result.rows.map((row) => ({
    id: row.id,
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
     GROUP BY ce.id, coaches.name`
  );

  return result.rows;
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
