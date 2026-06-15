import { createHash } from "node:crypto";
import fs from "node:fs";
import { Client } from "pg";
import {
  buildGmailDiscussionReadPlan,
  hasGmailDiscussionConfig,
  readGmailOperationDiscussionReferences
} from "../src/lib/sourceReads/gmailDiscussionReader.ts";
import {
  hasManualEmailDiscussionArchiveConfig,
  readManualEmailOperationDiscussionReferences
} from "../src/lib/sourceReads/manualEmailDiscussionArchiveReader.ts";

loadEnv(".env");
loadEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const operation = await readPreviewOperation(args.operationId);

if (!operation) {
  console.error("No operation found for preview.");
  process.exit(1);
}

const plan = buildGmailDiscussionReadPlan(operation);

console.log(JSON.stringify({
  selectedOperation: {
    fingerprint: fingerprint(operation.operationId),
    sourceTeam: operation.sourceTeam ?? "미분류",
    startDate: operation.startDate,
    endDate: operation.endDate,
    hasCourseId: Boolean(operation.courseId)
  },
  readPlan: {
    manualArchive: {
      enabled: plan.manualArchiveEnabled,
      untilDate: plan.manualArchiveUntilDate || null,
      source: "gitignored JSON summary records"
    },
    liveGmail: {
      enabled: plan.liveGmailEnabled,
      afterDate: plan.liveGmailSearchAfterDate || null,
      teamGroupFilterEnabled: plan.teamGroupFilterEnabled,
      searchTermKinds: plan.searchTermKinds
    },
    normalization: [
      "messages.get uses metadata/snippet only",
      "full mail body is not requested or printed",
      "summary uses subject/from/snippet or manual summary",
      "items become DiscussionReference with sourceLabel=메일"
    ]
  }
}, null, 2));

if (args.read) {
  const results = [];

  if (hasManualEmailDiscussionArchiveConfig()) {
    results.push(await readManualEmailOperationDiscussionReferences());
  }

  if (hasGmailDiscussionConfig()) {
    results.push(await readGmailOperationDiscussionReferences(operation));
  }

  console.log(JSON.stringify({
    readResult: {
      sourceCount: results.length,
      statusBySource: results.map((result) => ({
        status: result.status,
        itemCount: result.items.length,
        issueCodes: result.issues.map((issue) => issue.code)
      })),
      sanitizedItems: results.flatMap((result) =>
        result.items.slice(0, 5).map((item) => ({
          idFingerprint: fingerprint(item.sourceMessageId),
          occurredAt: item.occurredAt,
          sourceKind: item.sourceKind ?? "email",
          titleLength: item.title.length,
          summaryLength: item.summary?.length ?? 0,
          hasSourceUrl: Boolean(item.sourceUrl)
        }))
      )
    }
  }, null, 2));
}

function parseArgs(argv) {
  const parsed = {
    operationId: process.env.EMAIL_DISCUSSION_PREVIEW_OPERATION_ID ?? "",
    read: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--operation-id") {
      parsed.operationId = argv[index + 1] ?? "";
    }

    if (arg === "--read") {
      parsed.read = true;
    }
  }

  return parsed;
}

async function readPreviewOperation(operationId) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for email discussion preview.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query(
      `
        select
          s.operation_id,
          c.course_id,
          co.name as company_name,
          c.course_name,
          s.start_date,
          s.end_date,
          s.om_name,
          s.ld_name,
          sr.source_team
        from operation_sessions s
        join courses c on c.id = s.course_record_id
        join companies co on co.id = c.company_id
        left join lateral (
          select source_team
          from operation_source_records
          where operation_session_id = s.id
          order by created_at desc
          limit 1
        ) sr on true
        where s.deleted_at is null
          and ($1::text = '' or s.operation_id = $1)
          and ($1::text <> '' or s.start_date >= date '2026-01-01')
        order by s.start_date asc, s.operation_id asc
        limit 1
      `,
      [operationId]
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: "",
      operationId: row.operation_id,
      sourceTeam: mapSourceTeam(row.source_team),
      courseId: row.course_id ?? "",
      companyName: row.company_name ?? "",
      courseName: row.course_name ?? "",
      om: row.om_name ?? "",
      ld: row.ld_name ?? "",
      startDate: dateOnly(row.start_date),
      endDate: dateOnly(row.end_date),
      roundNo: "",
      instructors: "",
      coach: ""
    };
  } finally {
    await client.end();
  }
}

function mapSourceTeam(value) {
  if (value === "team_1") return "1팀";
  if (value === "team_2") return "2팀";
  return "미분류";
}

function dateOnly(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

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
