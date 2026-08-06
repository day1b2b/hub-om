/**
 * 만족도 집계 시트(eduops_log)를 운영 세션에 매칭해보는 드라이런.
 * DB에 아무것도 쓰지 않고, 매칭/미매칭/모호 결과만 리포트로 출력한다.
 *
 * 준비:
 *   1) 구글시트의 eduops_log 탭을 CSV로 내려받는다 (파일 > 다운로드 > CSV).
 *   2) DATABASE_URL 환경변수(.env.local 또는 .env)가 운영 DB를 가리키게 한다.
 *
 * 실행:
 *   npm run satisfaction:dry-run -- --csv=./eduops_log.csv
 *   npm run satisfaction:dry-run -- --csv=./eduops_log.csv --limit=100
 */

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";
import {
  matchSatisfactionRow,
  parseSatisfactionCsv,
  type SatisfactionMatchResult
} from "@/lib/data/satisfactionSheet.ts";
import type { OperationCandidate } from "@/lib/data/operationMatch/matchOperation.ts";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

function parseArg(name: string): string | null {
  const arg = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return arg ? arg.slice(`--${name}=`.length) : null;
}

function parseLimit(): number {
  const parsed = Number(parseArg("limit"));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
}

function dateOnly(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  return match ? match[0] : "";
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

function summarize(results: SatisfactionMatchResult[]) {
  const matched = results.filter((r) => r.status === "matched").length;
  const ambiguous = results.filter((r) => r.status === "ambiguous").length;
  const unmatched = results.filter((r) => r.status === "unmatched").length;
  return { total: results.length, matched, ambiguous, unmatched };
}

async function main(): Promise<void> {
  const csvPath = parseArg("csv");
  if (!csvPath) {
    console.error("[satisfaction:dry-run] --csv=<파일경로> 가 필요합니다. (eduops_log 탭을 CSV로 내려받아 지정)");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[satisfaction:dry-run] DATABASE_URL 이 없어 운영 후보를 불러올 수 없습니다.");
    process.exit(1);
  }

  const limit = parseLimit();
  const sheetRows = parseSatisfactionCsv(readFileSync(csvPath, "utf8")).filter((row) => row.overall !== "" || row.course !== "");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const candidates = await loadOperationCandidates(client);
    const results = sheetRows.map((row) => matchSatisfactionRow(row, candidates));
    const stats = summarize(results);

    console.log(
      `[satisfaction:dry-run] 시트 ${stats.total}행 / 운영 후보 ${candidates.length}건`
    );
    console.log(
      `  matched(자동연결 가능) ${stats.matched} · ambiguous(모호·수동확인) ${stats.ambiguous} · unmatched(후보없음) ${stats.unmatched}`
    );

    console.log("\n[matched — 자동으로 연결될 행]");
    console.table(
      results
        .filter((r) => r.status === "matched")
        .slice(0, limit)
        .map((r) => ({
          course: r.row.course,
          instructor: r.row.instructor,
          date: r.row.date,
          overall: r.row.overall,
          posPct: r.row.posPct ?? "",
          n: r.row.respondents ?? "",
          operationId: r.operationId ?? "",
          score: r.ranked[0]?.score ?? 0
        }))
    );

    console.log("\n[ambiguous — 후보는 있으나 확신 부족(오매칭 방지로 보류)]");
    console.table(
      results
        .filter((r) => r.status === "ambiguous")
        .slice(0, limit)
        .map((r) => ({
          course: r.row.course,
          instructor: r.row.instructor,
          date: r.row.date,
          top1: r.ranked[0] ? `${r.ranked[0].candidate.courseName}(${r.ranked[0].score})` : "",
          top2: r.ranked[1] ? `${r.ranked[1].candidate.courseName}(${r.ranked[1].score})` : ""
        }))
    );

    console.log("\n[unmatched — 매칭 후보 없음(과정명/일정 확인 필요)]");
    console.table(
      results
        .filter((r) => r.status === "unmatched")
        .slice(0, limit)
        .map((r) => ({
          course: r.row.course,
          instructor: r.row.instructor,
          date: r.row.date,
          courseId: r.row.courseId
        }))
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[satisfaction:dry-run] 실패:", error);
  process.exit(1);
});
