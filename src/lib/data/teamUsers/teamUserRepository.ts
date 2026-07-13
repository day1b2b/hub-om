import fs from "fs";
import path from "path";
import type { TeamUser, TeamUserInput } from "./teamUserTypes";

const DATA_FILE = path.join(process.cwd(), "team-users.json");

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

export function listTeamUsers(): TeamUser[] {
  return readAll();
}

export function createTeamUser(input: TeamUserInput): TeamUser {
  const users = readAll();
  const newUser: TeamUser = {
    ...input,
    id: `usr-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  writeAll([...users, newUser]);
  return newUser;
}

export function deleteTeamUsers(ids: string[]): number {
  const users = readAll();
  const filtered = users.filter((u) => !ids.includes(u.id));
  writeAll(filtered);
  return users.length - filtered.length;
}
