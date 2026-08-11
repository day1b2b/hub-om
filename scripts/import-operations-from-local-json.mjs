import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

const OPERATION_STATUS = {
  "배정필요": "assignment_needed",
  "배정예정": "assignment_planned",
  "진행중": "active",
  "완료": "done",
  "회고완료": "retrospective_done",
  "아카이빙필요": "archive_needed"
};

const ARCHIVE_STATUS = {
  "아카이빙전": "not_ready",
  "아카이빙필요": "needed",
  "완료": "done"
};

const EDUCATION_FORMAT = {
  "오프라인": "offline",
  "비대면": "remote",
  "블렌디드": "blended",
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

const ONSITE_REQUIRED = {
  Y: "Y",
  N: "N",
  PARTIAL: "PARTIAL",
  UNKNOWN: "UNKNOWN"
};

const RESULT_REPORT_STATUS = {
  "유": "yes",
  "무": "no",
  "불필요": "not_required",
  "확인필요": "needs_review",
  "검토필요": "needs_review"
};

const SOURCE_TEAM = {
  "1팀": "team_1",
  "2팀": "team_2",
  "미분류": "unknown"
};

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  assertSafeDatabase(databaseUrl, options.dryRun);

  const operations = await readOperations(options.file);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const summary = {
    dryRun: options.dryRun,
    file: options.file,
    operations: operations.length,
    inserted: 0,
    updated: 0,
    sourceRecordsInserted: 0,
    sourceRecordsSkipped: 0
  };

  try {
    await client.query("BEGIN");
    const roleAssignees = await loadRoleAssignees(client);
    const importRunId = await createImportRun(client, options.file, operations.length, options.dryRun);

    for (const [index, operation] of operations.entries()) {
      const existingSession =
        (await findOperationSession(client, operation.operationId)) ??
        (await findOperationSessionByBusinessKey(client, operation));
      const companyId = await upsertCompany(client, operation.companyName);
      const courseId = await upsertCourse(client, companyId, operation);
      const sessionId = existingSession
        ? await updateOperationSession(client, existingSession.id, courseId, operation, roleAssignees)
        : await upsertOperationSession(client, courseId, operation, roleAssignees);

      if (existingSession) {
        summary.updated += 1;
      } else {
        summary.inserted += 1;
      }

      const sourceRecordInserted = await createSourceRecordIfMissing(
        client,
        importRunId,
        sessionId,
        operation,
        index + 1
      );

      if (sourceRecordInserted) {
        summary.sourceRecordsInserted += 1;
      } else {
        summary.sourceRecordsSkipped += 1;
      }
    }

    await finishImportRun(client, importRunId, operations.length, summary.inserted + summary.updated, options.dryRun);

    if (options.dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function parseOptions(args) {
  const fileArg = args.find((arg) => arg.startsWith("--file="));

  return {
    dryRun: args.includes("--dry-run"),
    file: fileArg ? fileArg.slice("--file=".length) : process.env.OPERATION_IMPORT_FILE ?? ".local/operations.json"
  };
}

async function readOperations(fileName) {
  const absolutePath = path.resolve(process.cwd(), fileName);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  const operations = Array.isArray(parsed) ? parsed : parsed.operations;

  if (!Array.isArray(operations)) {
    throw new Error("Operation import file must be an array or an object with an operations array.");
  }

  return operations.map(normalizeOperation).filter(Boolean);
}

function normalizeOperation(operation) {
  if (!operation || typeof operation !== "object") return null;

  const normalized = {
    ...operation,
    operationId: normalizeVisibleText(operation.operationId),
    companyName: normalizeVisibleText(operation.companyName),
    courseName: normalizeVisibleText(operation.courseName),
    courseId: normalizeVisibleText(operation.courseId)
  };

  if (!normalized.operationId) {
    throw new Error("operationId is required for every operation.");
  }

  if (!normalized.companyName) {
    throw new Error(`companyName is required for ${normalized.operationId}.`);
  }

  if (!normalized.courseName) {
    normalized.courseName = "과정명 미확인";
    normalized.validationErrors = uniqueStrings([...arrayValue(normalized.validationErrors), "과정명 누락"]);
  }

  parseDateValue(normalized.startDate, "startDate", normalized.operationId);
  parseDateValue(normalized.endDate, "endDate", normalized.operationId);

  return normalized;
}

async function createImportRun(client, fileName, rowCount, dryRun) {
  const result = await client.query(
    `
      INSERT INTO data_import_runs (
        id,
        source_team,
        source_type,
        source_name,
        file_name,
        status,
        row_count,
        notes
      )
      VALUES ($1, 'unknown'::source_team, 'legacy_json', 'Local JSON operation import', $2, 'pending'::import_status, $3, $4)
      RETURNING id
    `,
    [
      randomUUID(),
      path.basename(fileName),
      rowCount,
      dryRun ? "Dry run; transaction rolled back after validation." : "Imported from local standardized operation JSON."
    ]
  );

  return result.rows[0].id;
}

async function finishImportRun(client, importRunId, rowCount, successCount, dryRun) {
  await client.query(
    `
      UPDATE data_import_runs
      SET status = 'completed'::import_status,
          success_count = $2,
          error_count = $3,
          finished_at = CURRENT_TIMESTAMP,
          notes = $4
      WHERE id = $1
    `,
    [importRunId, successCount, rowCount - successCount, dryRun ? "Dry run completed; rolled back." : "Import completed."]
  );
}

async function findOperationSession(client, operationId) {
  const result = await client.query("SELECT id FROM operation_sessions WHERE operation_id = $1 LIMIT 1", [operationId]);
  return result.rows[0] ?? null;
}

async function findOperationSessionByBusinessKey(client, operation) {
  const result = await client.query(
    `
      SELECT s.id
      FROM operation_sessions s
      JOIN courses c ON c.id = s.course_record_id
      JOIN companies co ON co.id = c.company_id
      WHERE s.deleted_at IS NULL
        AND co.normalized_name = $1
        AND c.course_name = $2
        AND s.start_date = $3
        AND s.end_date = $4
      ORDER BY s.created_at ASC, s.id ASC
      LIMIT 1
    `,
    [
      normalizeName(operation.companyName),
      normalizeVisibleText(operation.courseName),
      parseDateValue(operation.startDate, "startDate", operation.operationId),
      parseDateValue(operation.endDate, "endDate", operation.operationId)
    ]
  );

  return result.rows[0] ?? null;
}

async function upsertCompany(client, companyName) {
  const name = normalizeVisibleText(companyName);
  const result = await client.query(
    `
      INSERT INTO companies (id, name, normalized_name, created_at, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (normalized_name)
      DO UPDATE SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [randomUUID(), name, normalizeName(name)]
  );

  return result.rows[0].id;
}

async function upsertCourse(client, companyId, operation) {
  const courseId = normalizeVisibleText(operation.courseId);
  const courseName = normalizeVisibleText(operation.courseName);
  const result = await client.query(
    `
      INSERT INTO courses (
        id,
        company_id,
        course_id,
        course_name,
        operation_type,
        revenue,
        revenue_raw,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::operation_type, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (company_id, course_id, course_name)
      DO UPDATE SET
        operation_type = EXCLUDED.operation_type,
        revenue = EXCLUDED.revenue,
        revenue_raw = EXCLUDED.revenue_raw,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [
      randomUUID(),
      companyId,
      courseId,
      courseName,
      enumValue(OPERATION_TYPE, operation.operationType, "needs_review"),
      nullableNumber(operation.revenue),
      normalizeVisibleText(operation.revenueRaw ?? operation.revenue)
    ]
  );

  return result.rows[0].id;
}

async function upsertOperationSession(client, courseRecordId, operation, roleAssignees) {
  const sourceFingerprint = sourceFingerprintFor(operation);
  const fieldValues = operationSessionFieldValues(operation, roleAssignees, sourceFingerprint);
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
        $1, $2, $3, $4, $5::jsonb, $6::operation_status, $7::archive_status, $8::education_format,
        $9, $10::operation_channel, $11, $12, $13, $14, $15, $16, $17::operation_type, $18,
        $19, $20, $21, $22, $23, $24::onsite_required, $25, $26, $27, $28, $29, $30, $31, $32,
        $33, $34, $35, $36, $37, $38, $39, $40::result_report_status, $41, $42, $43,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (operation_id)
      DO UPDATE SET
        course_record_id = EXCLUDED.course_record_id,
        source_fingerprint = EXCLUDED.source_fingerprint,
        validation_errors = EXCLUDED.validation_errors,
        operation_status = EXCLUDED.operation_status,
        archive_status = EXCLUDED.archive_status,
        education_format = EXCLUDED.education_format,
        education_format_raw = EXCLUDED.education_format_raw,
        operation_channel = EXCLUDED.operation_channel,
        round_no = EXCLUDED.round_no,
        education_days = EXCLUDED.education_days,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        operation_month = EXCLUDED.operation_month,
        session_duration_days = EXCLUDED.session_duration_days,
        session_duration_type = EXCLUDED.session_duration_type,
        time_text = EXCLUDED.time_text,
        om_name = EXCLUDED.om_name,
        ld_name = EXCLUDED.ld_name,
        instructors_text = EXCLUDED.instructors_text,
        coach_text = EXCLUDED.coach_text,
        region = EXCLUDED.region,
        onsite_required = EXCLUDED.onsite_required,
        onsite_text = EXCLUDED.onsite_text,
        special_notes = EXCLUDED.special_notes,
        operation_issue = EXCLUDED.operation_issue,
        om_update = EXCLUDED.om_update,
        drive_link = EXCLUDED.drive_link,
        operation_detail = EXCLUDED.operation_detail,
        company_wiki_link = EXCLUDED.company_wiki_link,
        instructor_wiki_link = EXCLUDED.instructor_wiki_link,
        cost_raw = EXCLUDED.cost_raw,
        profit_raw = EXCLUDED.profit_raw,
        total_cost = EXCLUDED.total_cost,
        instructor_cost = EXCLUDED.instructor_cost,
        operation_cost = EXCLUDED.operation_cost,
        avg_satisfaction = EXCLUDED.avg_satisfaction,
        instructor_satisfaction = EXCLUDED.instructor_satisfaction,
        has_result_report = EXCLUDED.has_result_report,
        result_report_link = EXCLUDED.result_report_link,
        lecture_management_link = EXCLUDED.lecture_management_link,
        padlet_link = EXCLUDED.padlet_link,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [
      randomUUID(),
      operation.operationId,
      courseRecordId,
      ...fieldValues
    ]
  );

  return result.rows[0].id;
}

async function updateOperationSession(client, sessionId, courseRecordId, operation, roleAssignees) {
  const sourceFingerprint = sourceFingerprintFor(operation);
  const fieldValues = operationSessionFieldValues(operation, roleAssignees, sourceFingerprint);
  const result = await client.query(
    `
      UPDATE operation_sessions
      SET
        course_record_id = $1,
        source_fingerprint = $2,
        validation_errors = $3::jsonb,
        operation_status = $4::operation_status,
        archive_status = $5::archive_status,
        education_format = $6::education_format,
        education_format_raw = $7,
        operation_channel = $8::operation_channel,
        round_no = $9,
        education_days = $10,
        start_date = $11,
        end_date = $12,
        operation_month = $13,
        session_duration_days = $14,
        session_duration_type = $15::operation_type,
        time_text = $16,
        om_name = $17,
        ld_name = $18,
        instructors_text = $19,
        coach_text = $20,
        region = $21,
        onsite_required = $22::onsite_required,
        onsite_text = $23,
        special_notes = $24,
        operation_issue = $25,
        om_update = $26,
        drive_link = $27,
        operation_detail = $28,
        company_wiki_link = $29,
        instructor_wiki_link = $30,
        cost_raw = $31,
        profit_raw = $32,
        total_cost = $33,
        instructor_cost = $34,
        operation_cost = $35,
        avg_satisfaction = $36,
        instructor_satisfaction = $37,
        has_result_report = $38::result_report_status,
        result_report_link = $39,
        lecture_management_link = $40,
        padlet_link = $41,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $42
      RETURNING id
    `,
    [courseRecordId, ...fieldValues, sessionId]
  );

  return result.rows[0].id;
}

function operationSessionFieldValues(operation, roleAssignees, sourceFingerprint) {
  return [
    sourceFingerprint,
    JSON.stringify(arrayValue(operation.validationErrors)),
    enumValue(OPERATION_STATUS, operation.operationStatus, "assignment_needed"),
    enumValue(ARCHIVE_STATUS, operation.archiveStatus, "not_ready"),
    enumValue(EDUCATION_FORMAT, operation.educationFormat, "needs_review"),
    nullableText(operation.educationFormatRaw),
    enumValue(OPERATION_CHANNEL, operation.operationChannel, "needs_review"),
    nullableText(operation.roundNo),
    nullableText(operation.educationDays),
    parseDateValue(operation.startDate, "startDate", operation.operationId),
    parseDateValue(operation.endDate, "endDate", operation.operationId),
    nullableText(operation.operationMonth),
    nullableInteger(operation.sessionDurationDays),
    enumValue(OPERATION_TYPE, operation.sessionDurationType, "needs_review"),
    nullableText(operation.timeText),
    nullableText(normalizeAssigneeNames(operation.om, roleAssignees.om)),
    nullableText(normalizeAssigneeNames(operation.ld, roleAssignees.ld)),
    nullableText(operation.instructors),
    nullableText(operation.coach),
    nullableText(operation.region),
    enumValue(ONSITE_REQUIRED, operation.onsiteRequired, "UNKNOWN"),
    nullableText(operation.onsiteText),
    nullableText(operation.specialNotes),
    nullableText(operation.operationIssue),
    nullableText(operation.omUpdate),
    nullableText(operation.driveLink),
    nullableText(operation.operationDetail),
    nullableText(operation.companyWikiLink),
    nullableText(operation.instructorWikiLink),
    nullableText(operation.costRaw),
    nullableText(operation.profitRaw),
    nullableNumber(operation.totalCost),
    nullableNumber(operation.instructorCost),
    nullableNumber(operation.operationCost),
    nullableText(operation.avgSatisfaction),
    nullableText(operation.instructorSatisfaction),
    enumValue(RESULT_REPORT_STATUS, operation.hasResultReport, "needs_review"),
    nullableText(operation.resultReportLink),
    nullableText(operation.lectureManagementLink),
    nullableText(operation.padletLink)
  ];
}

async function createSourceRecordIfMissing(client, importRunId, operationSessionId, operation, rowNumber) {
  const sourceFingerprint = sourceFingerprintFor(operation);
  const existing = await client.query(
    `
      SELECT id
      FROM operation_source_records
      WHERE operation_session_id = $1
        AND source_fingerprint = $2
      LIMIT 1
    `,
    [operationSessionId, sourceFingerprint]
  );

  if (existing.rows[0]) return false;

  await client.query(
    `
      INSERT INTO operation_source_records (
        id,
        import_run_id,
        operation_session_id,
        source_team,
        source_workbook,
        source_sheet,
        source_row_number,
        source_fingerprint,
        row_snapshot,
        mapped_fields,
        validation_errors
      )
      VALUES ($1, $2, $3, $4::source_team, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
    `,
    [
      randomUUID(),
      importRunId,
      operationSessionId,
      enumValue(SOURCE_TEAM, operation.sourceTeam, "unknown"),
      "local-standardized-operations",
      "operations",
      rowNumber,
      sourceFingerprint,
      JSON.stringify(operation),
      JSON.stringify(operation),
      JSON.stringify(arrayValue(operation.validationErrors))
    ]
  );

  return true;
}

function assertSafeDatabase(databaseUrl, dryRun) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (!isLocalHost && !dryRun && process.env.ALLOW_NON_LOCAL_OPERATION_IMPORT !== "true") {
    throw new Error(
      `Refusing to import operations to non-local database host: ${host}. Set ALLOW_NON_LOCAL_OPERATION_IMPORT=true to allow this write.`
    );
  }
}

function sourceFingerprintFor(operation) {
  return `legacy-json:${operation.operationId}`;
}

function enumValue(values, value, fallback) {
  return values[normalizeVisibleText(value)] ?? fallback;
}

function nullableText(value) {
  const text = normalizeVisibleText(value);
  return text || null;
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

function normalizeVisibleText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function normalizeName(value) {
  return normalizeVisibleText(value).toLowerCase();
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableInteger(value) {
  const parsed = nullableNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function arrayValue(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function parseDateValue(value, fieldName, operationId) {
  const text = normalizeVisibleText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

  if (!match) {
    throw new Error(`${fieldName} must be YYYY-MM-DD for ${operationId}. Received: ${text}`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`${fieldName} is invalid for ${operationId}. Received: ${text}`);
  }

  return text;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
