import fs from "node:fs";
import { Client } from "pg";
import { scanOperationDriveFolder, searchOperationDriveFolders } from "../src/lib/driveImports/googleDriveOperationScanner.ts";

function loadEnv(path) {
  if (!fs.existsSync(path)) return;

  for (const rawLine of fs.readFileSync(path, "utf8").split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const args = {
    concurrency: Number(process.env.DRIVE_IMPORT_DRY_RUN_CONCURRENCY || 3),
    limit: 0,
    mode: "dry_run"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") args.limit = Number(argv[index + 1] ?? 0);
    if (arg === "--concurrency") args.concurrency = Number(argv[index + 1] ?? 3);
    if (arg === "--mode") args.mode = String(argv[index + 1] ?? "dry_run");
  }

  args.concurrency = Number.isFinite(args.concurrency) && args.concurrency > 0 ? Math.floor(args.concurrency) : 3;
  args.limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 0;
  return args;
}

function dateOnly(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function pickScanInput(operation) {
  if (operation.driveLink?.trim()) return { kind: "driveLink", value: operation.driveLink.trim() };
  if (operation.lectureManagementLink?.trim()) {
    return { kind: "lectureManagementLink", value: operation.lectureManagementLink.trim() };
  }
  return null;
}

function summarizeSuspicious(candidates) {
  return {
    zeroSatisfactionCandidates: candidates.filter(
      (candidate) =>
        (candidate.field === "avgSatisfaction" || candidate.field === "instructorSatisfaction") &&
        candidate.value === "0.00"
    ).length,
    clockInstructorCandidates: candidates.filter(
      (candidate) => candidate.field === "instructors" && candidate.value === "시계"
    ).length,
    badInstructorFragments: candidates.filter(
      (candidate) => candidate.field === "instructors" && candidate.value === "등에서도"
    ).length
  };
}

function keyCandidate(candidate) {
  return {
    confidence: candidate.confidence,
    evidence: candidate.evidence ?? "",
    field: candidate.field,
    label: candidate.label,
    sourceTitle: candidate.sourceTitle,
    value: candidate.value
  };
}

async function loadOperations(client, limit) {
  const limitSql = limit > 0 ? `limit ${limit}` : "";
  const result = await client.query(`
    select
      s.id,
      s.operation_id,
      co.name as company_name,
      c.course_name,
      s.start_date,
      s.end_date,
      s.om_name,
      s.ld_name,
      s.drive_link,
      s.lecture_management_link
    from operation_sessions s
    join courses c on c.id = s.course_record_id
    join companies co on co.id = c.company_id
    where s.deleted_at is null
    order by s.start_date asc, s.operation_id asc
    ${limitSql}
  `);

  return result.rows.map((row) => ({
    id: row.id,
    operationId: row.operation_id,
    companyName: row.company_name ?? "",
    courseName: row.course_name ?? "",
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    om: row.om_name ?? "",
    ld: row.ld_name ?? "",
    driveLink: row.drive_link ?? "",
    lectureManagementLink: row.lecture_management_link ?? ""
  }));
}

async function insertRun(client, args, operationCount) {
  const result = await client.query(
    `
      insert into drive_import_runs (mode, status, operation_count, notes)
      values ($1, 'pending', $2, $3)
      returning id
    `,
    [args.mode, operationCount, "Read-only Drive import dry run. Operation data is not modified."]
  );

  return result.rows[0].id;
}

async function insertResult(client, runId, operation, input, result) {
  await client.query(
    `
      insert into drive_import_results (
        run_id,
        operation_session_id,
        operation_id,
        company_name,
        course_name,
        start_date,
        end_date,
        input_kind,
        input_value,
        result_kind,
        folder_id,
        folder_title,
        folder_url,
        file_count,
        candidate_count,
        key_candidates,
        folder_candidates,
        issues,
        error
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19)
    `,
    [
      runId,
      operation.id,
      operation.operationId,
      operation.companyName,
      operation.courseName,
      operation.startDate || null,
      operation.endDate || null,
      input.kind,
      input.value,
      result.resultKind,
      result.folderId ?? null,
      result.folderTitle ?? null,
      result.folderUrl ?? null,
      result.fileCount ?? 0,
      result.candidateCount ?? 0,
      JSON.stringify(result.keyCandidates ?? []),
      JSON.stringify(result.folderCandidates ?? []),
      JSON.stringify(result.issues ?? []),
      result.error ?? null
    ]
  );
}

async function updateRun(client, runId, summary, status) {
  await client.query(
    `
      update drive_import_runs
      set
        status = $2,
        scanned_ref_count = $3,
        scan_found_folder_count = $4,
        scan_issue_count = $5,
        folder_search_count = $6,
        folder_search_with_candidates_count = $7,
        avg_satisfaction_candidate_count = $8,
        instructor_satisfaction_candidate_count = $9,
        instructor_candidate_count = $10,
        suspicious_candidate_count = $11,
        error_count = $12,
        summary = $13::jsonb,
        finished_at = now()
      where id = $1
    `,
    [
      runId,
      status,
      summary.scannedRefs,
      summary.scanFoundFolder,
      summary.scanIssues,
      summary.folderSearches,
      summary.folderSearchWithCandidates,
      summary.avgSatisfactionCandidates,
      summary.instructorSatisfactionCandidates,
      summary.instructorCandidates,
      summary.suspiciousCandidateCount,
      summary.errors,
      JSON.stringify(summary)
    ]
  );
}

async function main() {
  loadEnv(".env");
  loadEnv(".env.local");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const args = parseArgs(process.argv.slice(2));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const operations = await loadOperations(client, args.limit);
  const runId = await insertRun(client, args, operations.length);
  const summary = {
    avgSatisfactionCandidates: 0,
    errors: 0,
    folderSearches: 0,
    folderSearchWithCandidates: 0,
    instructorCandidates: 0,
    instructorSatisfactionCandidates: 0,
    scanFoundFolder: 0,
    scanIssues: 0,
    scannedRefs: 0,
    suspicious: {
      badInstructorFragments: 0,
      clockInstructorCandidates: 0,
      zeroSatisfactionCandidates: 0
    },
    suspiciousCandidateCount: 0
  };
  let processed = 0;

  async function processOperation(operation) {
    const input = pickScanInput(operation);

    try {
      if (input) {
        summary.scannedRefs += 1;
        const scan = await scanOperationDriveFolder(input.value);
        const candidates = scan.candidates.map(keyCandidate);
        const suspicious = summarizeSuspicious(candidates);

        summary.scanFoundFolder += scan.folderId ? 1 : 0;
        summary.scanIssues += scan.issues.length ? 1 : 0;
        summary.avgSatisfactionCandidates += candidates.filter((candidate) => candidate.field === "avgSatisfaction").length;
        summary.instructorSatisfactionCandidates += candidates.filter((candidate) => candidate.field === "instructorSatisfaction").length;
        summary.instructorCandidates += candidates.filter((candidate) => candidate.field === "instructors").length;
        summary.suspicious.zeroSatisfactionCandidates += suspicious.zeroSatisfactionCandidates;
        summary.suspicious.clockInstructorCandidates += suspicious.clockInstructorCandidates;
        summary.suspicious.badInstructorFragments += suspicious.badInstructorFragments;
        summary.suspiciousCandidateCount +=
          suspicious.zeroSatisfactionCandidates + suspicious.clockInstructorCandidates + suspicious.badInstructorFragments;

        await insertResult(client, runId, operation, input, {
          candidateCount: candidates.length,
          fileCount: scan.files.length,
          folderId: scan.folderId,
          folderTitle: scan.folderTitle,
          folderUrl: scan.folderUrl,
          issues: scan.issues,
          keyCandidates: candidates.filter((candidate) =>
            ["driveLink", "lectureManagementLink", "resultReportLink", "avgSatisfaction", "instructorSatisfaction", "instructors"].includes(candidate.field)
          ),
          resultKind: scan.folderId ? "scan_found_folder" : "scan_no_folder"
        });
      } else {
        summary.folderSearches += 1;
        const search = await searchOperationDriveFolders(operation);
        summary.folderSearchWithCandidates += search.candidates.length ? 1 : 0;
        await insertResult(client, runId, operation, { kind: "folderSearch", value: "" }, {
          candidateCount: search.candidates.length,
          folderCandidates: search.candidates.slice(0, 10).map((candidate) => ({
            confidence: candidate.confidence,
            reasons: candidate.reasons,
            score: candidate.score,
            title: candidate.title,
            url: candidate.url
          })),
          issues: search.issues,
          resultKind: search.candidates.length ? "folder_search_candidates" : "folder_search_empty"
        });
      }
    } catch (error) {
      summary.errors += 1;
      await insertResult(client, runId, operation, input ?? { kind: "folderSearch", value: "" }, {
        error: error instanceof Error ? error.message : String(error),
        resultKind: "error"
      });
    } finally {
      processed += 1;
      if (processed % 25 === 0 || processed === operations.length) {
        console.log(`[drive-import-dry-run] ${processed}/${operations.length}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(args.concurrency, operations.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < operations.length; index += args.concurrency) {
      await processOperation(operations[index]);
    }
  });

  await Promise.all(workers);
  const status = summary.errors > 0 ? "completed_with_errors" : "completed";
  await updateRun(client, runId, summary, status);
  await client.end();

  console.log(JSON.stringify({ runId, status, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
