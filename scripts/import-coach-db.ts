/**
 * coach-db → hub-om import 스크립트.
 *
 * 동작:
 *   - 인자 없거나 --dry-run: dry-run (쓰기 0).
 *   - --apply: 트랜잭션으로 실제 upsert 수행.
 *
 * 안전 제약:
 *   - 소스(COACH_DB_DATABASE_URL)는 읽기 전용. 타깃(DATABASE_URL)에만 쓴다.
 *   - 두 환경변수 중 하나라도 없으면 어떤 DB에도 접속하지 않고 즉시 종료한다.
 *
 * PII 경계:
 *   - 운영 식별자(name)는 coaches 테이블에만.
 *   - 민감정보(employee_id/phone/email/birth_date/affiliation)는
 *     coach_private_profiles 테이블에만. (아래 INSERT 블록이 코드상 분리됨)
 *
 * 실행:
 *   node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
 *     scripts/import-coach-db.ts [--dry-run | --apply]
 */

import { config } from "dotenv";
import pg from "pg";
import { matchOperation, type OperationCandidate } from "../src/lib/data/coachImport/matchOperation.ts";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

interface Options {
  apply: boolean;
}

interface Summary {
  coachCount: number;
  engagementCount: number;
  scheduleCount: number;
  matchedOperationCount: number;
  unmatchedOperationCount: number;
  errorCount: number;
}

function parseOptions(args: string[]): Options {
  return { apply: args.includes("--apply") };
}

/**
 * matchOperation 정규화와 동일 규칙: trim + 내부 연속공백 1칸 + 소문자.
 */
function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * @db.Date 컬럼 값을 'YYYY-MM-DD' 문자열로 변환. matchOperation 후보 비교용.
 */
function dateOnly(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? match[0] : "";
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  // --- env 안전 실패: 접속 시도 전에 검증한다 ---
  const sourceUrl = process.env.COACH_DB_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;

  const missing: string[] = [];
  if (!sourceUrl) missing.push("COACH_DB_DATABASE_URL (소스 coach-db 읽기 전용)");
  if (!targetUrl) missing.push("DATABASE_URL (타깃 hub-om)");

  if (missing.length > 0) {
    console.error("[import-coach-db] 필수 환경변수가 없어 실행을 중단합니다. 어떤 DB에도 접속하지 않았습니다.");
    for (const name of missing) {
      console.error(`  - 누락: ${name}`);
    }
    console.error("  .env.local 또는 .env 에 위 변수를 설정한 뒤 다시 실행하세요.");
    process.exit(1);
  }

  console.log(`[import-coach-db] 모드: ${options.apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);

  // --- 소스 읽기 (읽기 전용) ---
  const source = new Client({ connectionString: sourceUrl });
  await source.connect();

  let sourceData: SourceData;
  try {
    sourceData = await readSource(source);
  } finally {
    await source.end();
  }

  // --- 타깃: 운영 후보 조회 + (apply 시) 쓰기 ---
  const target = new Client({ connectionString: targetUrl });
  await target.connect();

  const startedAt = new Date();
  const summary: Summary = {
    coachCount: 0,
    engagementCount: 0,
    scheduleCount: 0,
    matchedOperationCount: 0,
    unmatchedOperationCount: 0,
    errorCount: 0
  };

  try {
    const candidates = await loadOperationCandidates(target);

    if (!options.apply) {
      // dry-run: 매칭만 계산하고 쓰기는 하지 않는다.
      computeDryRunMatches(sourceData, candidates, summary);
      printSummary(summary, options);
      return;
    }

    await target.query("BEGIN");
    try {
      await applyImport(target, sourceData, candidates, summary);
      await recordImportRun(target, summary, startedAt);
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }

    printSummary(summary, options);
  } finally {
    await target.end();
  }
}

interface SourceCoach {
  id: string;
  employee_id: string | null;
  name: string;
  birth_date: unknown;
  phone: string | null;
  email: string | null;
  affiliation: string | null;
  work_type: string | null;
  status: string;
  deleted_at: Date | null;
}

interface SourceEngagement {
  id: string;
  coach_id: string;
  course_name: string;
  status: string;
  source: string;
  start_date: unknown;
  end_date: unknown;
  start_time: string | null;
  end_time: string | null;
  rating: number | null;
  feedback: string | null;
  rehire: boolean | null;
  hired_by: string | null;
}

interface SourceEngagementSchedule {
  id: string;
  engagement_id: string;
  coach_id: string;
  date: unknown;
  start_time: string;
  end_time: string;
  cancelled_at: Date | null;
}

interface SourceCoachSchedule {
  id: string;
  coach_id: string;
  date: unknown;
  start_time: string;
  end_time: string;
  updated_at: Date | null;
}

interface SourceTag {
  id: string;
  name: string;
}

interface SourceCoachTag {
  coach_id: string;
  tag_id: string;
}

interface SourceData {
  coaches: SourceCoach[];
  engagements: SourceEngagement[];
  engagementSchedules: SourceEngagementSchedule[];
  coachSchedules: SourceCoachSchedule[];
  fields: SourceTag[];
  coachFields: SourceCoachTag[];
  curriculums: SourceTag[];
  coachCurriculums: SourceCoachTag[];
}

async function readSource(client: pg.Client): Promise<SourceData> {
  const coaches = await client.query<SourceCoach>(
    `SELECT id, employee_id, name, birth_date, phone, email, affiliation, work_type, status, deleted_at
     FROM coaches`
  );
  const engagements = await client.query<SourceEngagement>(
    `SELECT id, coach_id, course_name, status, source, start_date, end_date,
            start_time, end_time, rating, feedback, rehire, hired_by
     FROM engagements`
  );
  const engagementSchedules = await client.query<SourceEngagementSchedule>(
    `SELECT id, engagement_id, coach_id, date, start_time, end_time, cancelled_at
     FROM engagement_schedules`
  );
  const coachSchedules = await client.query<SourceCoachSchedule>(
    `SELECT id, coach_id, date, start_time, end_time, updated_at
     FROM coach_schedules`
  );
  const fields = await client.query<SourceTag>(`SELECT id, name FROM fields`);
  const coachFields = await client.query<SourceCoachTag>(`SELECT coach_id, field_id AS tag_id FROM coach_fields`);
  const curriculums = await client.query<SourceTag>(`SELECT id, name FROM curriculums`);
  const coachCurriculums = await client.query<SourceCoachTag>(
    `SELECT coach_id, curriculum_id AS tag_id FROM coach_curriculums`
  );

  return {
    coaches: coaches.rows,
    engagements: engagements.rows,
    engagementSchedules: engagementSchedules.rows,
    coachSchedules: coachSchedules.rows,
    fields: fields.rows,
    coachFields: coachFields.rows,
    curriculums: curriculums.rows,
    coachCurriculums: coachCurriculums.rows
  };
}

async function loadOperationCandidates(client: pg.Client): Promise<OperationCandidate[]> {
  const result = await client.query<{ id: string; course_name: string; start_date: unknown; end_date: unknown }>(
    `SELECT os.id, c.course_name AS course_name, os.start_date, os.end_date
     FROM operation_sessions os
     JOIN courses c ON os.course_record_id = c.id
     WHERE os.deleted_at IS NULL`
  );

  return result.rows.map((row) => ({
    id: row.id,
    courseName: row.course_name ?? "",
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date)
  }));
}

function computeDryRunMatches(data: SourceData, candidates: OperationCandidate[], summary: Summary): void {
  summary.coachCount = data.coaches.length;
  summary.scheduleCount = data.coachSchedules.length;

  for (const engagement of data.engagements) {
    summary.engagementCount += 1;
    const matched = matchOperation(
      {
        courseName: engagement.course_name ?? "",
        startDate: dateOnly(engagement.start_date),
        endDate: dateOnly(engagement.end_date)
      },
      candidates
    );
    if (matched) {
      summary.matchedOperationCount += 1;
    } else {
      summary.unmatchedOperationCount += 1;
    }
  }
}

async function applyImport(
  client: pg.Client,
  data: SourceData,
  candidates: OperationCandidate[],
  summary: Summary
): Promise<void> {
  const coachIdMap = new Map<string, string>(); // sourceCoachId -> hubCoachId
  const engagementIdMap = new Map<string, string>(); // sourceEngagementId -> hubEngagementId

  // =========================================================================
  // 1) coaches — 운영 식별자(name)만. 민감정보 절대 없음.
  // =========================================================================
  for (const coach of data.coaches) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO coaches (
         source_coach_id, name, normalized_name, work_type, status, is_active, display_order, deleted_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5::coach_status, $6, NULL, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (source_coach_id) DO UPDATE SET
         name = EXCLUDED.name,
         normalized_name = EXCLUDED.normalized_name,
         work_type = EXCLUDED.work_type,
         status = EXCLUDED.status,
         is_active = EXCLUDED.is_active,
         deleted_at = EXCLUDED.deleted_at,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        coach.id,
        coach.name,
        normalizeName(coach.name),
        coach.work_type,
        coach.status,
        coach.deleted_at === null,
        coach.deleted_at
      ]
    );

    const hubCoachId = result.rows[0].id;
    coachIdMap.set(coach.id, hubCoachId);
    summary.coachCount += 1;

    // =======================================================================
    // 2) coach_private_profiles — 민감정보 전용 테이블.
    //    employee_id/phone/email/birth_date/affiliation 만 여기에 적재한다.
    //    name 등 운영 식별자는 절대 넣지 않는다.
    // =======================================================================
    await client.query(
      `INSERT INTO coach_private_profiles (coach_id, employee_id, phone, email, birth_date, affiliation, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (coach_id) DO UPDATE SET
         employee_id = EXCLUDED.employee_id,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         birth_date = EXCLUDED.birth_date,
         affiliation = EXCLUDED.affiliation,
         updated_at = CURRENT_TIMESTAMP`,
      [
        hubCoachId,
        coach.employee_id,
        coach.phone,
        coach.email,
        coach.birth_date ?? null,
        coach.affiliation
      ]
    );
  }

  // =========================================================================
  // 3) fields/curriculums 마스터 + 코치 태그 연결 (비민감)
  // =========================================================================
  const fieldMasterMap = await upsertTagMasters(client, "coach_field_masters", data.fields);
  await linkCoachTags(client, "coach_fields", data.coachFields, coachIdMap, fieldMasterMap);

  const curriculumMasterMap = await upsertTagMasters(client, "coach_curriculum_masters", data.curriculums);
  await linkCoachTags(client, "coach_curriculums", data.coachCurriculums, coachIdMap, curriculumMasterMap);

  // =========================================================================
  // 4) coach_schedules (비민감)
  // =========================================================================
  for (const schedule of data.coachSchedules) {
    const hubCoachId = coachIdMap.get(schedule.coach_id);
    if (!hubCoachId) {
      summary.errorCount += 1;
      continue;
    }

    await client.query(
      `INSERT INTO coach_schedules (source_schedule_id, coach_id, date, start_time, end_time, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_TIMESTAMP))
       ON CONFLICT (source_schedule_id) DO UPDATE SET
         coach_id = EXCLUDED.coach_id,
         date = EXCLUDED.date,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         updated_at = COALESCE(EXCLUDED.updated_at, CURRENT_TIMESTAMP)`,
      [schedule.id, hubCoachId, schedule.date, schedule.start_time, schedule.end_time, schedule.updated_at]
    );
    summary.scheduleCount += 1;
  }

  // =========================================================================
  // 5) engagements → coach_engagements (+ 운영 매칭)
  //    feedback/hired_by 는 private 성격이나 schema상 coach_engagements 컬럼.
  // =========================================================================
  for (const engagement of data.engagements) {
    const hubCoachId = coachIdMap.get(engagement.coach_id);
    if (!hubCoachId) {
      summary.errorCount += 1;
      continue;
    }

    const startDate = dateOnly(engagement.start_date);
    const endDate = dateOnly(engagement.end_date);
    const operationSessionId = matchOperation(
      { courseName: engagement.course_name ?? "", startDate, endDate },
      candidates
    );

    if (operationSessionId) {
      summary.matchedOperationCount += 1;
    } else {
      summary.unmatchedOperationCount += 1;
    }

    const result = await client.query<{ id: string }>(
      `INSERT INTO coach_engagements (
         source_engagement_id, coach_id, course_name, status, source,
         start_date, end_date, start_time, end_time, rating, rehire, feedback,
         hired_by_text, hired_by_id, operation_session_id
       )
       VALUES ($1, $2, $3, $4::coach_engagement_status, $5::coach_engagement_source,
               $6, $7, $8, $9, $10, $11, $12, $13, NULL, $14)
       ON CONFLICT (source_engagement_id) DO UPDATE SET
         coach_id = EXCLUDED.coach_id,
         course_name = EXCLUDED.course_name,
         status = EXCLUDED.status,
         source = EXCLUDED.source,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         rating = EXCLUDED.rating,
         rehire = EXCLUDED.rehire,
         feedback = EXCLUDED.feedback,
         hired_by_text = EXCLUDED.hired_by_text,
         operation_session_id = EXCLUDED.operation_session_id
       RETURNING id`,
      [
        engagement.id,
        hubCoachId,
        engagement.course_name,
        engagement.status,
        engagement.source,
        startDate || null,
        endDate || null,
        engagement.start_time,
        engagement.end_time,
        engagement.rating,
        engagement.rehire,
        engagement.feedback,
        engagement.hired_by,
        operationSessionId
      ]
    );

    engagementIdMap.set(engagement.id, result.rows[0].id);
    summary.engagementCount += 1;
  }

  // =========================================================================
  // 6) engagement_schedules → coach_engagement_schedules
  // =========================================================================
  for (const schedule of data.engagementSchedules) {
    const hubCoachId = coachIdMap.get(schedule.coach_id);
    const hubEngagementId = engagementIdMap.get(schedule.engagement_id);
    if (!hubCoachId || !hubEngagementId) {
      summary.errorCount += 1;
      continue;
    }

    await client.query(
      `INSERT INTO coach_engagement_schedules (
         source_engagement_schedule_id, engagement_id, coach_id, date, start_time, end_time, cancelled_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (source_engagement_schedule_id) DO UPDATE SET
         engagement_id = EXCLUDED.engagement_id,
         coach_id = EXCLUDED.coach_id,
         date = EXCLUDED.date,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         cancelled_at = EXCLUDED.cancelled_at`,
      [
        schedule.id,
        hubEngagementId,
        hubCoachId,
        schedule.date,
        schedule.start_time,
        schedule.end_time,
        schedule.cancelled_at
      ]
    );
  }
}

async function upsertTagMasters(
  client: pg.Client,
  table: "coach_field_masters" | "coach_curriculum_masters",
  tags: SourceTag[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // sourceTagId -> hubMasterId
  for (const tag of tags) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO ${table} (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tag.name]
    );
    map.set(tag.id, result.rows[0].id);
  }
  return map;
}

async function linkCoachTags(
  client: pg.Client,
  table: "coach_fields" | "coach_curriculums",
  links: SourceCoachTag[],
  coachIdMap: Map<string, string>,
  masterMap: Map<string, string>
): Promise<void> {
  for (const link of links) {
    const hubCoachId = coachIdMap.get(link.coach_id);
    const hubTagId = masterMap.get(link.tag_id);
    if (!hubCoachId || !hubTagId) continue;

    await client.query(
      `INSERT INTO ${table} (coach_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT (coach_id, tag_id) DO NOTHING`,
      [hubCoachId, hubTagId]
    );
  }
}

async function recordImportRun(client: pg.Client, summary: Summary, startedAt: Date): Promise<void> {
  const status = summary.errorCount > 0 ? "completed_with_errors" : "completed";
  await client.query(
    `INSERT INTO coach_import_runs (
       mode, status, coach_count, engagement_count, schedule_count,
       matched_operation_count, error_count, summary, started_at, finished_at
     )
     VALUES ('apply', $1::import_status, $2, $3, $4, $5, $6, $7::jsonb, $8, CURRENT_TIMESTAMP)`,
    [
      status,
      summary.coachCount,
      summary.engagementCount,
      summary.scheduleCount,
      summary.matchedOperationCount,
      summary.errorCount,
      JSON.stringify(summary),
      startedAt
    ]
  );
}

function printSummary(summary: Summary, options: Options): void {
  console.log(
    `[import-coach-db] ${options.apply ? "apply 완료" : "dry-run 완료 (쓰기 0)"}: ` +
      `코치 ${summary.coachCount} / 투입 ${summary.engagementCount} / 스케줄 ${summary.scheduleCount} / ` +
      `운영매칭 ${summary.matchedOperationCount}건 / 미매칭 ${summary.unmatchedOperationCount}건` +
      (summary.errorCount > 0 ? ` / 에러 ${summary.errorCount}건` : "")
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
