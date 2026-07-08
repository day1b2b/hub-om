import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config({ path: ".env" });

const SOURCE_TEAM_VALUE = {
  "1팀": "team_1",
  "2팀": "team_2",
  "미분류": null
};

const TEAM_MEMBER_ROLE_VALUE = {
  ld: "ld",
  LD: "ld",
  om: "om",
  OM: "om"
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to import team members.");
}

assertSafeDatabase(databaseUrl);

const localFile = path.resolve(process.cwd(), ".local", "team-members.json");
const raw = await readFile(localFile, "utf8");
const payload = JSON.parse(raw);
const members = normalizeMembers(payload.members ?? []);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("BEGIN");

  for (const [index, member] of members.entries()) {
    const role = TEAM_MEMBER_ROLE_VALUE[member.role];
    const sourceTeam = sourceTeamValue(member.sourceTeam);
    const normalizedName = normalizeName(member.name);
    const displayOrder = member.displayOrder ?? index + 1;
    const updated = await client.query(
      `
        UPDATE members
        SET name = $4,
            role_title = $5,
            calendar_id = $6,
            is_active = true,
            display_order = $7,
            updated_at = CURRENT_TIMESTAMP
        WHERE role = $1::member_role
          AND source_team IS NOT DISTINCT FROM $2::source_team
          AND normalized_name = $3
        RETURNING id
      `,
      [
        role,
        sourceTeam,
        normalizedName,
        member.name,
        member.roleTitle ?? null,
        member.calendarId ?? null,
        displayOrder
      ]
    );

    if (updated.rowCount === 0) {
      await client.query(
        `
          INSERT INTO members (
            id,
            role,
            source_team,
            name,
            normalized_name,
            role_title,
            calendar_id,
            is_active,
            display_order,
            updated_at
          )
          VALUES ($1, $2::member_role, $3::source_team, $4, $5, $6, $7, true, $8, CURRENT_TIMESTAMP)
        `,
        [
          randomUUID(),
          role,
          sourceTeam,
          member.name,
          normalizedName,
          member.roleTitle ?? null,
          member.calendarId ?? null,
          displayOrder
        ]
      );
    }
  }

  for (const [role, sourceTeam, normalizedNames] of membersBySourceTeam(members)) {
    await client.query(
      `
        UPDATE members
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE role = $1::member_role
          AND source_team IS NOT DISTINCT FROM $2::source_team
          AND NOT (normalized_name = ANY($3::text[]))
      `,
      [TEAM_MEMBER_ROLE_VALUE[role], sourceTeam, normalizedNames]
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
      role: member.role,
      sourceTeam: member.sourceTeam
    }))
    .filter((member) => member.name && isValidSourceTeam(member.sourceTeam) && TEAM_MEMBER_ROLE_VALUE[member.role]);
}

function normalizeName(name) {
  return name.replace(/\s+/g, "").toLowerCase();
}

function assertSafeDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (!isLocalHost && process.env.ALLOW_NON_LOCAL_TEAM_MEMBER_IMPORT !== "true") {
    throw new Error(`Refusing to import team members to non-local database host: ${host}`);
  }
}

function membersBySourceTeam(members) {
  const groups = new Map();

  for (const member of members) {
    const key = JSON.stringify([member.role, sourceTeamValue(member.sourceTeam)]);
    const normalizedNames = groups.get(key) ?? [];
    normalizedNames.push(normalizeName(member.name));
    groups.set(key, normalizedNames);
  }

  return Array.from(groups.entries()).map(([key, normalizedNames]) => {
    const [role, sourceTeam] = JSON.parse(key);
    return [role, sourceTeam, normalizedNames];
  });
}

function isValidSourceTeam(sourceTeam) {
  return sourceTeam === undefined || sourceTeam === null || Object.hasOwn(SOURCE_TEAM_VALUE, sourceTeam);
}

function sourceTeamValue(sourceTeam) {
  if (sourceTeam === undefined || sourceTeam === null) return null;
  return SOURCE_TEAM_VALUE[sourceTeam];
}
