import fs from "fs";
import path from "path";
import { getPrismaClient } from "../prisma";
import type { TeamUser, TeamUserInput } from "./teamUserTypes";

const DATA_FILE = path.join(process.cwd(), "team-users.json");

function hasDatabaseUrl(): boolean {
  return process.env.OPERATION_DATA_SOURCE !== "local" && Boolean(process.env.DATABASE_URL);
}

function readAll(): TeamUser[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as TeamUser[];
  } catch {
    return [];
  }
}

function writeAll(users: TeamUser[]) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf-8");
}

function toTeamUser(row: { id: string; name: string; email: string; slackId: string; team: string | null; createdAt: Date }): TeamUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    slackId: row.slackId,
    team: row.team ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

export async function listTeamUsers(): Promise<TeamUser[]> {
  if (!hasDatabaseUrl()) return readAll();

  const prisma = getPrismaClient();
  const rows = await prisma.teamUser.findMany({ orderBy: { createdAt: "desc" } });

  return rows.map(toTeamUser);
}

export async function createTeamUser(input: TeamUserInput): Promise<TeamUser> {
  if (!hasDatabaseUrl()) {
    const users = readAll();
    const newUser: TeamUser = {
      ...input,
      id: `usr-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    writeAll([...users, newUser]);
    return newUser;
  }

  const prisma = getPrismaClient();
  const row = await prisma.teamUser.create({
    data: {
      email: input.email,
      name: input.name,
      slackId: input.slackId,
      team: input.team ?? null
    }
  });

  return toTeamUser(row);
}

export async function deleteTeamUsers(ids: string[]): Promise<number> {
  if (!hasDatabaseUrl()) {
    const users = readAll();
    const filtered = users.filter((u) => !ids.includes(u.id));
    writeAll(filtered);
    return users.length - filtered.length;
  }

  const prisma = getPrismaClient();
  const result = await prisma.teamUser.deleteMany({ where: { id: { in: ids } } });

  return result.count;
}
