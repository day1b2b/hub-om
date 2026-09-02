import fs from "fs";
import path from "path";
import type { MemberRole } from "@prisma/client";
import { getPrismaClient } from "../prisma";
import type { TeamUser, TeamUserInput, TeamUserRole } from "./teamUserTypes";

const DATA_FILE = path.join(process.cwd(), "team-users.json");

const ROLE_TO_PRISMA: Record<TeamUserRole, MemberRole> = { ld: "LD", om: "OM" };
const ROLE_FROM_PRISMA: Record<MemberRole, TeamUserRole> = { LD: "ld", OM: "om" };

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

function toTeamUser(row: {
  id: string;
  name: string;
  email: string;
  slackId: string;
  team: string | null;
  role: MemberRole | null;
  createdAt: Date;
}): TeamUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    slackId: row.slackId,
    team: row.team ?? undefined,
    role: row.role ? ROLE_FROM_PRISMA[row.role] : undefined,
    createdAt: row.createdAt.toISOString()
  };
}

export async function listTeamUsers(): Promise<TeamUser[]> {
  if (!hasDatabaseUrl()) return readAll();

  const prisma = getPrismaClient();
  const rows = await prisma.teamUser.findMany({ orderBy: { createdAt: "desc" } });

  return rows.map(toTeamUser);
}

/** 이메일 표기를 비교용으로 맞춘다(앞뒤 공백·대소문자 무시). */
function emailKey(value: null | string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * 이 이메일로 등록된 명단 행 전부. 중복이 있으면 여러 개가 돌아온다.
 *
 * 내 대시보드는 로그인 이메일 → 명단의 이름 → 운영 현황 OM 칸 순으로 이어진다.
 * 같은 이메일 행이 둘이면 어느 이름이 잡힐지가 명단 등록 순서에 달리고,
 * 그 이름이 운영 현황 표기와 다르면 담당 과정이 통째로 0건으로 보인다.
 * 화면에서 원인을 짚어 주기 위해 전부 돌려준다.
 */
export async function findTeamUsersByEmail(email: null | string | undefined): Promise<TeamUser[]> {
  const target = emailKey(email);
  if (!target) return [];

  const users = await listTeamUsers();
  return users.filter((user) => emailKey(user.email) === target);
}

/** 같은 이메일이 이미 명단에 있을 때 createTeamUser가 던지는 오류. */
export class DuplicateTeamUserEmailError extends Error {
  readonly existingNames: string[];

  constructor(email: string, existingNames: string[]) {
    super(`이미 명단에 있는 이메일입니다: ${email}`);
    this.name = "DuplicateTeamUserEmailError";
    this.existingNames = existingNames;
  }
}

export async function createTeamUser(input: TeamUserInput): Promise<TeamUser> {
  // 같은 이메일을 두 번 등록하면 나중 행이 조회를 이기고(listTeamUsers가 createdAt 내림차순)
  // 먼저 있던 이름을 가려, 그 사람 대시보드가 조용히 0건이 된다. 만들기 전에 막는다.
  const duplicates = await findTeamUsersByEmail(input.email);
  if (duplicates.length > 0) {
    throw new DuplicateTeamUserEmailError(
      (input.email ?? "").trim(),
      duplicates.map((user) => user.name)
    );
  }

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
      team: input.team ?? null,
      role: input.role ? ROLE_TO_PRISMA[input.role] : null
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

export async function updateTeamUserTeam(id: string, team: string | null): Promise<TeamUser | null> {
  if (!hasDatabaseUrl()) {
    const users = readAll();
    let updatedUser: TeamUser | null = null;
    const next = users.map((u) => {
      if (u.id !== id) return u;
      updatedUser = { ...u, team: team ?? undefined };
      return updatedUser;
    });
    if (!updatedUser) return null;
    writeAll(next);
    return updatedUser;
  }

  const prisma = getPrismaClient();
  try {
    const row = await prisma.teamUser.update({
      where: { id },
      data: { team }
    });
    return toTeamUser(row);
  } catch {
    return null;
  }
}

export async function updateTeamUsersRole(ids: string[], role: TeamUserRole): Promise<number> {
  if (!hasDatabaseUrl()) {
    const users = readAll();
    let updated = 0;
    const next = users.map((u) => {
      if (!ids.includes(u.id)) return u;
      updated += 1;
      return { ...u, role };
    });
    writeAll(next);
    return updated;
  }

  const prisma = getPrismaClient();
  const result = await prisma.teamUser.updateMany({
    where: { id: { in: ids } },
    data: { role: ROLE_TO_PRISMA[role] }
  });

  return result.count;
}
