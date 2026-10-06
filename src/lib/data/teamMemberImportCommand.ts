import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodePrivateJson } from "../privacy/crypto";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { disconnectPrismaClient } from "./prisma";
import type { TeamMemberImportEntry, TeamMemberImportRepository, TeamMemberImportRole, TeamMemberImportSourceTeam } from "./teamMemberImportRepository";
import { getTeamMemberImportRepository } from "./teamMemberImportRepositoryFactory";

const MAX_SOURCE_BYTES = 4 * 1024 * 1024, MAX_ENTRIES = 20_000;
export function parseTeamMemberImportArgs(args: string[]) {
  const allowed = new Set(["--dry-run", "--apply", "--backup-confirmed", "--maintenance-confirmed"]);
  if (args.some(arg => !allowed.has(arg)) || args.includes("--dry-run") && args.includes("--apply")) throw new Error("TEAM_MEMBER_IMPORT_FAILED");
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) throw new Error("TEAM_MEMBER_IMPORT_FAILED");
  return { apply };
}
export function assertSafeTeamMemberImportDatabase(databaseUrl: string | undefined, allowNonLocal: string | undefined) {
  if (!databaseUrl) throw new Error("TEAM_MEMBER_IMPORT_FAILED");
  let host: string; try { host = new URL(databaseUrl).hostname; } catch { throw new Error("TEAM_MEMBER_IMPORT_FAILED"); }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && allowNonLocal !== "true") throw new Error("TEAM_MEMBER_IMPORT_FAILED");
}
export function parseTeamMemberImportSource(source: string): TeamMemberImportEntry[] {
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error("TEAM_MEMBER_IMPORT_FAILED");
  const payload: unknown = decodePrivateJson(source.trimEnd(), "local:team-members");
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray((payload as { members?: unknown }).members)) throw new Error("TEAM_MEMBER_IMPORT_FAILED");
  const raw = (payload as { members: unknown[] }).members; if (raw.length > MAX_ENTRIES) throw new Error("TEAM_MEMBER_IMPORT_FAILED");
  const entries: TeamMemberImportEntry[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>, name = typeof item.name === "string" ? item.name.trim() : "", role = normalizeRole(item.role), sourceTeam = normalizeSourceTeam(item.sourceTeam);
    if (!name || !role || sourceTeam === undefined) continue;
    const displayOrder = item.displayOrder ?? entries.length + 1;
    if (!Number.isInteger(displayOrder) || Number(displayOrder) < -2147483648 || Number(displayOrder) > 2147483647) throw new Error("TEAM_MEMBER_IMPORT_FAILED");
    if (item.roleTitle !== undefined && item.roleTitle !== null && typeof item.roleTitle !== "string" || item.calendarId !== undefined && item.calendarId !== null && typeof item.calendarId !== "string") throw new Error("TEAM_MEMBER_IMPORT_FAILED");
    entries.push({ name, normalizedName: name.replace(/\s+/g, "").toLowerCase(), role, sourceTeam,
      roleTitle: (item.roleTitle as string | null | undefined) ?? null, calendarId: (item.calendarId as string | null | undefined) ?? null, displayOrder: Number(displayOrder) });
  }
  return entries;
}
function normalizeRole(value: unknown): TeamMemberImportRole | undefined { return value === "om" || value === "OM" ? "OM" : value === "ld" || value === "LD" ? "LD" : undefined; }
function normalizeSourceTeam(value: unknown): TeamMemberImportSourceTeam | undefined {
  if (value === undefined || value === null || value === "미분류") return null;
  return value === "1팀" ? "TEAM_1" : value === "2팀" ? "TEAM_2" : undefined;
}
interface Dependencies { readSource(): Promise<string>; getDefaultRepository(): TeamMemberImportRepository; closeDefaultRepository(): Promise<void>; }
const defaults: Dependencies = { readSource: () => readFile(path.join(process.cwd(), ".local", "team-members.json"), "utf8"), getDefaultRepository: getTeamMemberImportRepository, closeDefaultRepository: disconnectPrismaClient };
export async function runTeamMemberImportCommand(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const options = parseTeamMemberImportArgs(args), scoped = getDataRepositoryOverride("teamMemberImport"); let result: Awaited<ReturnType<TeamMemberImportRepository["importMembers"]>> | undefined, failed = false;
  try { if (!scoped) { loadEnvironment(); assertSafeTeamMemberImportDatabase(process.env.DATABASE_URL, process.env.ALLOW_NON_LOCAL_TEAM_MEMBER_IMPORT); } const entries = parseTeamMemberImportSource(await dependencies.readSource()); result = await (scoped ?? dependencies.getDefaultRepository()).importMembers(entries, options.apply); }
  catch { failed = true; } finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { failed = true; } }
  if (failed || !result) throw new Error("TEAM_MEMBER_IMPORT_FAILED"); return { options, result };
}
