import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

const NON_BLOCKING_ERRORS = new Set(["코스ID 누락", "교육형태 매핑 검토 필요", "결과보고서 링크 누락"]);

const OPERATION_STATUS = {
  "배정필요": "assignment_needed",
  "배정예정": "assignment_planned",
  "배정 예정": "assignment_planned",
  "진행중": "active",
  "진행 중": "active",
  "완료": "done",
  "회고완료": "retrospective_done",
  "회고 완료": "retrospective_done",
  "아카이빙필요": "archive_needed",
  "아카이빙 필요": "archive_needed"
};

const ARCHIVE_STATUS = {
  "아카이빙전": "not_ready",
  "아카이빙 전": "not_ready",
  "아카이빙필요": "needed",
  "아카이빙 필요": "needed",
  "완료": "done"
};

const EDUCATION_FORMAT = {
  "오프라인": "offline",
  "비대면": "remote",
  "온라인": "remote",
  "블랜디드": "blended",
  "플립러닝": "flipped",
  "검토필요": "needs_review"
};

const OPERATION_CHANNEL = {
  onsite: "onsite",
  live_online: "live_online",
  online_platform: "online_platform",
  blended: "blended",
  needs_review: "needs_review"
};

const OPERATION_TYPE = {
  "특강": "lecture",
  "단기": "short",
  "중기": "medium",
  "중장기": "mid_term_long",
  "준장기": "mid_long",
  "장기": "long",
  "연간": "annual",
  "상시형": "always_on",
  "검토필요": "needs_review"
};

const RESULT_REPORT_STATUS = {
  "유": "yes",
  "무": "no",
  "불필요": "not_required",
  "확인필요": "needs_review",
  "검토필요": "needs_review"
};

async function main() {
  const sourceTeam = process.argv[2] ?? "team_1";
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  assertLocalDatabase(databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const roleAssignees = await loadRoleAssignees(client);
    const sourceRows = await client.query(
      `
        SELECT id, source_team, source_fingerprint, mapped_fields, validation_errors
        FROM operation_source_records
        WHERE source_team = $1
          AND operation_session_id IS NULL
        ORDER BY source_sheet, source_row_number
      `,
      [sourceTeam]
    );
    const summary = { blocked: 0, blockedReasons: {}, linkedExisting: 0, promoted: 0, sourceRows: sourceRows.rowCount };

    await client.query("BEGIN");

    for (const row of sourceRows.rows) {
      const fields = row.mapped_fields ?? {};
      const validationErrors = Array.isArray(row.validation_errors) ? row.validation_errors : [];
      const blockingErrors = validationErrors.filter((error) => !NON_BLOCKING_ERRORS.has(error));

      const blockedReason = getBlockedReason(fields, blockingErrors);
      if (blockedReason) {
        summary.blocked += 1;
        summary.blockedReasons[blockedReason] = (summary.blockedReasons[blockedReason] ?? 0) + 1;
        continue;
      }

      const existingSession = await findSessionByFingerprint(client, row.source_fingerprint);
      if (existingSession) {
        await linkSourceRecord(client, row.id, existingSession.id);
        summary.linkedExisting += 1;
        continue;
      }

      const companyId = await upsertCompany(client, fields.companyName);
      const courseId = await upsertCourse(client, companyId, fields);
      const sessionId = await createOperationSession(client, courseId, row, fields, validationErrors, roleAssignees);

      await linkSourceRecord(client, row.id, sessionId);
      summary.promoted += 1;
    }

    await client.query("COMMIT");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function assertLocalDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;

  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`Refusing to write to non-local database host: ${host}`);
  }
}

function getBlockedReason(fields, blockingErrors) {
  if (blockingErrors.length > 0) return blockingErrors.join(" | ");
  if (!normalizeVisibleText(fields.companyName)) return "기업명 누락";
  if (!normalizeVisibleText(fields.courseName)) return "과정명 누락";
  if (!parseDateValue(fields.startDate)) return "시작일 누락 또는 날짜 해석 실패";
  if (!parseDateValue(fields.endDate)) return "종료일 누락 또는 날짜 해석 실패";

  return null;
}

async function findSessionByFingerprint(client, sourceFingerprint) {
  if (!sourceFingerprint) return null;

  const result = await client.query("SELECT id FROM operation_sessions WHERE source_fingerprint = $1 LIMIT 1", [
    sourceFingerprint
  ]);
  return result.rows[0] ?? null;
}

async function upsertCompany(client, companyName) {
  const name = normalizeVisibleText(companyName);
  const normalizedName = normalizeName(name);
  const result = await client.query(
    `
      INSERT INTO companies (id, name, normalized_name, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (normalized_name)
      DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING id
    `,
    [randomUUID(), name, normalizedName]
  );

  return result.rows[0].id;
}

async function upsertCourse(client, companyId, fields) {
  const courseId = normalizeVisibleText(fields.courseId);
  const courseName = normalizeVisibleText(fields.courseName);
  const operationType = enumValue(OPERATION_TYPE, fields.operationType, "needs_review");
  const revenue = nullableNumber(fields.revenue);
  const revenueRaw = normalizeVisibleText(fields.revenueRaw);
  const result = await client.query(
    `
      INSERT INTO courses (id, company_id, course_id, course_name, operation_type, revenue, revenue_raw, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::operation_type, $6, $7, NOW(), NOW())
      ON CONFLICT (company_id, course_id, course_name)
      DO UPDATE SET
        operation_type = EXCLUDED.operation_type,
        revenue = EXCLUDED.revenue,
        revenue_raw = EXCLUDED.revenue_raw,
        updated_at = NOW()
      RETURNING id
    `,
    [randomUUID(), companyId, courseId, courseName, operationType, revenue, revenueRaw || null]
  );

  return result.rows[0].id;
}

async function createOperationSession(client, courseRecordId, sourceRow, fields, validationErrors, roleAssignees) {
  const startDate = parseDateValue(fields.startDate);
  const endDate = parseDateValue(fields.endDate);
  const operationId = stableOperationId(sourceRow.source_team, sourceRow.source_fingerprint);
  const result = await client.query(
    `
      INSERT INTO operation_sessions (
        id,
        operation_id,
        course_record_id,
        source_fingerprint,
        validation_errors,
        operation_status,
        archive_status,
        education_format,
        education_format_raw,
        operation_channel,
        round_no,
        education_days,
        start_date,
        end_date,
        operation_month,
        session_duration_days,
        session_duration_type,
        time_text,
        om_name,
        ld_name,
        instructors_text,
        coach_text,
        region,
        onsite_required,
        onsite_text,
        special_notes,
        operation_issue,
        om_update,
        drive_link,
        operation_detail,
        company_wiki_link,
        instructor_wiki_link,
        cost_raw,
        profit_raw,
        total_cost,
        instructor_cost,
        operation_cost,
        avg_satisfaction,
        instructor_satisfaction,
        has_result_report,
        result_report_link,
        lecture_management_link,
        padlet_link,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6::operation_status,
        $7::archive_status,
        $8::education_format,
        $9,
        $10::operation_channel,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17::operation_type,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24::onsite_required,
        $25,
        $26,
        $27,
        $28,
        $29,
        $30,
        $31,
        $32,
        $33,
        $34,
        $35,
        $36,
        $37,
        $38,
        $39,
        $40::result_report_status,
        $41,
        $42,
        $43,
        NOW(),
        NOW()
      )
      RETURNING id
    `,
    [
      randomUUID(),
      operationId,
      courseRecordId,
      sourceRow.source_fingerprint,
      JSON.stringify(validationErrors),
      enumValue(OPERATION_STATUS, fields.operationStatus, "assignment_needed"),
      enumValue(ARCHIVE_STATUS, fields.archiveStatus, "not_ready"),
      enumValue(EDUCATION_FORMAT, fields.educationFormat, "needs_review"),
      nullableText(fields.educationFormatRaw),
      enumValue(OPERATION_CHANNEL, fields.operationChannel, "needs_review"),
      nullableText(fields.roundNo),
      nullableText(fields.educationDays),
      startDate,
      endDate,
      operationMonth(startDate),
      nullableInteger(fields.sessionDurationDays) ?? dateDiffDays(startDate, endDate),
      enumValue(OPERATION_TYPE, fields.sessionDurationType, "needs_review"),
      nullableText(fields.timeText),
      nullableText(normalizeAssigneeNames(fields.om, roleAssignees.om)),
      nullableText(normalizeAssigneeNames(fields.ld, roleAssignees.ld)),
      nullableText(fields.instructors),
      nullableText(fields.coach),
      nullableText(fields.region),
      onsiteRequired(fields.onsiteRequired),
      nullableText(fields.onsiteText),
      nullableText(fields.specialNotes),
      nullableText(fields.operationIssue),
      nullableText(fields.omUpdate),
      nullableText(fields.driveLink),
      nullableText(fields.operationDetail),
      nullableText(fields.companyWikiLink),
      nullableText(fields.instructorWikiLink),
      nullableText(fields.costRaw),
      nullableText(fields.profitRaw),
      nullableNumber(fields.totalCost),
      nullableNumber(fields.instructorCost),
      nullableNumber(fields.operationCost),
      nullableText(fields.avgSatisfaction),
      nullableText(fields.instructorSatisfaction),
      enumValue(RESULT_REPORT_STATUS, fields.hasResultReport, "needs_review"),
      nullableText(fields.resultReportLink),
      nullableText(fields.lectureManagementLink),
      nullableText(fields.padletLink)
    ]
  );

  return result.rows[0].id;
}

async function linkSourceRecord(client, sourceRecordId, sessionId) {
  await client.query("UPDATE operation_source_records SET operation_session_id = $1 WHERE id = $2", [
    sessionId,
    sourceRecordId
  ]);
}

function stableOperationId(sourceTeam, sourceFingerprint) {
  const fingerprint = sourceFingerprint || randomUUID().replaceAll("-", "");
  return `SRC-${sourceTeam.replace("_", "").toUpperCase()}-${fingerprint.slice(0, 12).toUpperCase()}`;
}

function enumValue(map, value, fallback) {
  const normalized = normalizeVisibleText(value);
  return map[normalized] ?? map[value] ?? fallback;
}

function onsiteRequired(value) {
  if (value === "Y" || value === "N" || value === "PARTIAL" || value === "UNKNOWN") return value;
  return "UNKNOWN";
}

function normalizeVisibleText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function nullableText(value) {
  const normalized = normalizeVisibleText(value);
  return normalized || null;
}

async function loadRoleAssignees(client) {
  const result = await client.query(
    `
      SELECT role, name
      FROM members
      WHERE is_active = TRUE
        AND role IN ('om', 'ld')
      ORDER BY role, source_team, display_order, name
    `
  );
  const roleAssignees = { ld: [], om: [] };

  for (const row of result.rows) {
    if (row.role === "om" || row.role === "ld") {
      roleAssignees[row.role].push(row.name);
    }
  }

  return roleAssignees;
}

function normalizeAssigneeNames(value, allowedNames) {
  const allowedMap = new Map(allowedNames.map((name) => [normalizePersonKey(name), name]));
  const names = [];

  for (const rawName of String(value ?? "").split(/[,，、/]+/)) {
    const matchedName = allowedMap.get(normalizePersonKey(rawName));
    if (matchedName && !names.includes(matchedName)) {
      names.push(matchedName);
    }
  }

  return names.join(", ");
}

function normalizePersonKey(value) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeName(value) {
  return normalizeVisibleText(value).toLowerCase();
}

function parseDateValue(value) {
  const normalized = normalizeVisibleText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function operationMonth(dateValue) {
  return dateValue.slice(0, 7);
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableInteger(value) {
  const parsed = nullableNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function dateDiffDays(startValue, endValue) {
  const start = new Date(`${startValue}T00:00:00Z`);
  const end = new Date(`${endValue}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
