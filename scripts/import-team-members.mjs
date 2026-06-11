import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const SOURCE_TEAM_VALUE = {
  "1팀": "team_1",
  "2팀": "team_2",
  "미분류": "unknown"
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to import team members.");
}

const localFile = path.resolve(process.cwd(), ".local", "team-members.json");
const raw = await readFile(localFile, "utf8");
const payload = JSON.parse(raw);
const members = normalizeMembers(payload.members ?? []);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("BEGIN");

  for (const [index, member] of members.entries()) {
    await client.query(
      `
        INSERT INTO team_members (
          id,
          source_team,
          name,
          normalized_name,
          role_title,
          calendar_id,
          is_active,
          display_order,
          updated_at
        )
        VALUES ($1, $2::source_team, $3, $4, $5, $6, true, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (source_team, normalized_name)
        DO UPDATE SET
          name = EXCLUDED.name,
          role_title = EXCLUDED.role_title,
          calendar_id = EXCLUDED.calendar_id,
          is_active = true,
          display_order = EXCLUDED.display_order,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        randomUUID(),
        SOURCE_TEAM_VALUE[member.sourceTeam],
        member.name,
        normalizeName(member.name),
        member.roleTitle ?? null,
        member.calendarId ?? null,
        member.displayOrder ?? index + 1
      ]
    );
  }

  for (const [sourceTeam, normalizedNames] of membersBySourceTeam(members)) {
    await client.query(
      `
        UPDATE team_members
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE source_team = $1::source_team
          AND NOT (normalized_name = ANY($2::text[]))
      `,
      [SOURCE_TEAM_VALUE[sourceTeam], normalizedNames]
    );
  }

  await client.query("COMMIT");
  console.log(`Imported ${members.length} active team members.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

function normalizeMembers(members) {
  return members
    .map((member) => ({
      ...member,
      name: typeof member.name === "string" ? member.name.trim() : "",
      sourceTeam: member.sourceTeam
    }))
    .filter((member) => member.name && SOURCE_TEAM_VALUE[member.sourceTeam]);
}

function normalizeName(name) {
  return name.replace(/\s+/g, "").toLowerCase();
}

function membersBySourceTeam(members) {
  const groups = new Map();

  for (const member of members) {
    const normalizedNames = groups.get(member.sourceTeam) ?? [];
    normalizedNames.push(normalizeName(member.name));
    groups.set(member.sourceTeam, normalizedNames);
  }

  return groups.entries();
}
