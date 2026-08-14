// 이관 전용 1회성 스크립트. 이 저장소 자체는 로컬 파일을 쓰지 않는다(개발용은 .local/om-requests.json,
// 배포는 om_requests 테이블). 배포 컨테이너에 과거 로컬 파일(예: 루트의 om-requests.json)이 남아있는
// 경우에만, 그 파일을 받아 이 스크립트로 om_requests 테이블에 1회 옮긴다.
//
// import-operations-from-local-json.mjs와 같은 안전장치(로컬 DB 기본, dry-run 지원, 비-로컬 DB
// 쓰기 명시적 허용 필요)를 그대로 따른다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  assertSafeDatabase(databaseUrl, options.dryRun);

  const requests = await readOmRequests(options.file);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const summary = {
    dryRun: options.dryRun,
    file: options.file,
    requests: requests.length,
    inserted: 0,
    updated: 0,
    skipped: 0
  };

  try {
    await client.query("BEGIN");

    for (const request of requests) {
      const existing = await client.query("SELECT id FROM om_requests WHERE id = $1", [request.id]);

      if (existing.rows[0]) {
        await updateOmRequest(client, request);
        summary.updated += 1;
      } else {
        await insertOmRequest(client, request);
        summary.inserted += 1;
      }
    }

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
    file: fileArg ? fileArg.slice("--file=".length) : process.env.OM_REQUEST_IMPORT_FILE ?? "om-requests.json"
  };
}

async function readOmRequests(fileName) {
  const absolutePath = path.resolve(process.cwd(), fileName);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("om-request import file must be a JSON array.");
  }

  return parsed.map(normalizeOmRequest).filter(Boolean);
}

function normalizeOmRequest(request) {
  if (!request || typeof request !== "object") return null;
  if (!request.id) throw new Error("id is required for every om-request.");
  if (!request.company) throw new Error(`company is required for ${request.id}.`);
  if (!request.courseName) throw new Error(`courseName is required for ${request.id}.`);
  return request;
}

async function insertOmRequest(client, request) {
  await client.query(
    `
      INSERT INTO om_requests (
        id, assigned_om, operation_id, team, ld, company, business_number, training_type,
        course_id, course_name, course_category_major, course_category, tools, instructor_name,
        syncup_link, drive_link, skillflo_setup, skillmatch_setup, on_site_operation, coach_request,
        total_sessions, sessions, notes, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22::jsonb, $23, $24, CURRENT_TIMESTAMP
      )
    `,
    fieldValues(request)
  );
}

async function updateOmRequest(client, request) {
  const values = fieldValues(request);
  await client.query(
    `
      UPDATE om_requests SET
        assigned_om = $2, operation_id = $3, team = $4, ld = $5, company = $6, business_number = $7,
        training_type = $8, course_id = $9, course_name = $10, course_category_major = $11,
        course_category = $12, tools = $13, instructor_name = $14, syncup_link = $15, drive_link = $16,
        skillflo_setup = $17, skillmatch_setup = $18, on_site_operation = $19, coach_request = $20,
        total_sessions = $21, sessions = $22::jsonb, notes = $23, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    values
  );
}

function fieldValues(request) {
  return [
    request.id,
    nullableText(request.assignedOm),
    nullableText(request.operationId),
    text(request.team),
    text(request.ld),
    text(request.company),
    nullableText(request.businessNumber),
    text(request.trainingType),
    text(request.courseId),
    text(request.courseName),
    nullableText(request.courseCategoryMajor),
    text(request.courseCategory),
    nullableText(request.tools),
    text(request.instructorName),
    text(request.syncupLink),
    text(request.driveLink),
    text(request.skillfloSetup),
    text(request.skillmatchSetup),
    text(request.onSiteOperation),
    text(request.coachRequest),
    Number.isFinite(request.totalSessions) ? request.totalSessions : (request.sessions ?? []).length,
    JSON.stringify(request.sessions ?? []),
    nullableText(request.notes),
    request.createdAt ? new Date(request.createdAt) : new Date()
  ];
}

function assertSafeDatabase(databaseUrl, dryRun) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (!isLocalHost && !dryRun && process.env.ALLOW_NON_LOCAL_OM_REQUEST_IMPORT !== "true") {
    throw new Error(
      `Refusing to import om-requests to non-local database host: ${host}. Set ALLOW_NON_LOCAL_OM_REQUEST_IMPORT=true to allow this write.`
    );
  }
}

function text(value) {
  return String(value ?? "");
}

function nullableText(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
