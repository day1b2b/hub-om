// .local/instructor-wiki.json → instructor_notes 테이블로 적재한다.
// 강사명 기준 upsert이고, 노션 스냅샷(notion_profile)만 갱신한다.
// 사람이 입력한 값은 파일 쪽에 값이 있을 때만 덮어쓴다(COALESCE). 비어 있으면 DB 값을 유지한다.
//
// 개인정보(연락처·이메일·생년월일)는 DB로 옮기지 않는다. instructorNotePii가 걷어내고,
// 자유 입력란에 섞인 전화번호·이메일도 가린다. 원문은 .local 파일과 노션에 남는다.
//
// 사용법:
//   npm run db:import:instructor-notes              (기본: 드라이런, 쓰지 않음)
//   npm run db:import:instructor-notes -- --apply   (실제 적재)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { stripPiiFromNote } from "../src/lib/data/instructorNotePii.ts";
import type { InstructorNote } from "../src/lib/data/instructorNoteRepository.ts";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const SOURCE = path.join(process.cwd(), ".local", "instructor-wiki.json");

function orNull(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL이 없습니다. .env 또는 .env.local을 확인하세요.");
    process.exit(1);
  }

  let raw: Record<string, InstructorNote>;
  try {
    raw = JSON.parse(await readFile(SOURCE, "utf-8")) as Record<string, InstructorNote>;
  } catch (error) {
    console.error(`${SOURCE} 를 읽지 못했습니다:`, (error as Error).message);
    process.exit(1);
  }

  const entries = Object.entries(raw).map(([name, note]) => [name, stripPiiFromNote(note)] as const);
  const withProfile = entries.filter(([, note]) => note.notion).length;
  const withNotionId = entries.filter(([, note]) => note.notionId).length;

  console.log(`원본: ${SOURCE}`);
  console.log(`강사 ${entries.length}명 (노션 ID ${withNotionId}명 / 노션 프로필 ${withProfile}명)`);
  console.log("개인정보 제외: 연락처·이메일·생년월일은 DB로 옮기지 않습니다. 자유 입력란의 번호·메일도 가립니다.");
  console.log(APPLY ? "모드: 실제 적재(--apply)" : "모드: 드라이런 (쓰지 않음). 적재하려면 -- --apply");

  if (!APPLY) {
    for (const [name, note] of entries.slice(0, 3)) {
      console.log(`  예시 ${name}: ${JSON.stringify(note).slice(0, 160)}…`);
    }
    if (entries.length > 3) console.log(`  … 외 ${entries.length - 3}명`);
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let inserted = 0;
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const [name, note] of entries) {
      const syncedAt = note.notion?.syncedAt ? new Date(note.notion.syncedAt) : null;
      const result = await client.query(
        `INSERT INTO instructor_notes
           (id, instructor_name, display_name, notion_id, partner_id, notes,
            recruit_avoid, notion_profile, notion_synced_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (instructor_name) DO UPDATE SET
           display_name  = COALESCE(EXCLUDED.display_name, instructor_notes.display_name),
           notion_id     = COALESCE(EXCLUDED.notion_id,    instructor_notes.notion_id),
           partner_id    = COALESCE(EXCLUDED.partner_id,   instructor_notes.partner_id),
           notes         = COALESCE(EXCLUDED.notes,        instructor_notes.notes),
           recruit_avoid = instructor_notes.recruit_avoid OR EXCLUDED.recruit_avoid,
           notion_profile   = COALESCE(EXCLUDED.notion_profile,   instructor_notes.notion_profile),
           notion_synced_at = COALESCE(EXCLUDED.notion_synced_at, instructor_notes.notion_synced_at),
           updated_at    = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [
          name,
          orNull(note.displayName),
          orNull(note.notionId),
          orNull(note.partnerId),
          orNull(note.notes),
          note.recruitAvoid === true,
          note.notion ? JSON.stringify(note.notion) : null,
          syncedAt
        ]
      );
      if (result.rows[0]?.is_insert) inserted += 1;
      else updated += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("적재 실패, 롤백했습니다:", (error as Error).message);
    process.exitCode = 1;
    return;
  } finally {
    await client.end();
  }

  console.log(`완료 — 신규 ${inserted}건 / 갱신 ${updated}건`);
}

main();
