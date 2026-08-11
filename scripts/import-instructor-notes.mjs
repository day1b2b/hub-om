// .local/instructor-wiki.json → instructor_notes 테이블로 적재한다.
// 강사명 기준 upsert이고, 노션 스냅샷(notion_profile)만 갱신한다.
// 사람이 화면에서 입력한 값(display_name/partner_id/notes/recruit_avoid/contact/email)은
// 파일 쪽에 값이 있을 때만 덮어쓴다. 비어 있으면 DB에 이미 있는 값을 유지한다.
//
// 사용법:
//   node scripts/import-instructor-notes.mjs --dry-run    (기본: 쓰지 않고 결과만 출력)
//   node scripts/import-instructor-notes.mjs --apply      (실제 적재)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const SOURCE = path.join(process.cwd(), ".local", "instructor-wiki.json");

function orNull(value) {
  const text = typeof value === "string" ? value.trim() : value;
  return text === "" || text === undefined ? null : text;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL이 없습니다. .env 또는 .env.local을 확인하세요.");
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(await readFile(SOURCE, "utf-8"));
  } catch (error) {
    console.error(`${SOURCE} 를 읽지 못했습니다:`, error.message);
    process.exit(1);
  }

  const entries = Object.entries(raw);
  const withNotion = entries.filter(([, note]) => note?.notion).length;
  const withNotionId = entries.filter(([, note]) => note?.notionId).length;

  console.log(`원본: ${SOURCE}`);
  console.log(`강사 ${entries.length}명 (노션 ID ${withNotionId}명 / 노션 프로필 ${withNotion}명)`);
  console.log(APPLY ? "모드: 실제 적재(--apply)" : "모드: 드라이런 (쓰지 않음). 적재하려면 --apply");

  if (!APPLY) {
    for (const [name, note] of entries.slice(0, 5)) {
      console.log(`  예시 ${name}: notionId=${note.notionId ?? "-"} / 프로필=${note.notion ? "있음" : "없음"}`);
    }
    if (entries.length > 5) console.log(`  … 외 ${entries.length - 5}명`);
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let inserted = 0;
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const [name, note] of entries) {
      const syncedAt = note?.notion?.syncedAt ? new Date(note.notion.syncedAt) : null;
      const result = await client.query(
        `INSERT INTO instructor_notes
           (id, instructor_name, display_name, notion_id, partner_id, notes,
            recruit_avoid, contact, email, notion_profile, notion_synced_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (instructor_name) DO UPDATE SET
           display_name  = COALESCE(EXCLUDED.display_name,  instructor_notes.display_name),
           notion_id     = COALESCE(EXCLUDED.notion_id,     instructor_notes.notion_id),
           partner_id    = COALESCE(EXCLUDED.partner_id,    instructor_notes.partner_id),
           notes         = COALESCE(EXCLUDED.notes,         instructor_notes.notes),
           recruit_avoid = instructor_notes.recruit_avoid OR EXCLUDED.recruit_avoid,
           contact       = COALESCE(EXCLUDED.contact,       instructor_notes.contact),
           email         = COALESCE(EXCLUDED.email,         instructor_notes.email),
           notion_profile   = COALESCE(EXCLUDED.notion_profile,   instructor_notes.notion_profile),
           notion_synced_at = COALESCE(EXCLUDED.notion_synced_at, instructor_notes.notion_synced_at),
           updated_at    = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [
          name,
          orNull(note?.displayName),
          orNull(note?.notionId),
          orNull(note?.partnerId),
          orNull(note?.notes),
          note?.recruitAvoid === true,
          orNull(note?.contact),
          orNull(note?.email),
          note?.notion ? JSON.stringify(note.notion) : null,
          syncedAt
        ]
      );
      if (result.rows[0]?.is_insert) inserted += 1;
      else updated += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("적재 실패, 롤백했습니다:", error.message);
    process.exitCode = 1;
    return;
  } finally {
    await client.end();
  }

  console.log(`완료 — 신규 ${inserted}건 / 갱신 ${updated}건`);
}

main();
