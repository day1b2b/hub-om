import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { normalizeLegacyOperationText } from "./operationImportCore";
import type { OperationImportEntry, OperationImportRepository } from "./operationImportRepository";
import { getOperationImportRepository } from "./operationImportRepositoryFactory";
import { disconnectPrismaClient } from "./prisma";

const MAX_BYTES = 32 * 1024 * 1024, MAX_ROWS = 20_000;
export function parseOperationImportArgs(args: string[], env: Record<string, string | undefined>) {
  const fileArgs = args.filter(arg => arg.startsWith("--file="));
  const allowed = new Set(["--dry-run", "--apply", "--backup-confirmed", "--maintenance-confirmed"]);
  if (fileArgs.length > 1 || args.some(arg => !allowed.has(arg) && !arg.startsWith("--file=")) || args.includes("--dry-run") && args.includes("--apply")) throw new Error("OPERATION_IMPORT_FAILED");
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) throw new Error("OPERATION_IMPORT_FAILED");
  const file = fileArgs[0]?.slice("--file=".length) || env.OPERATION_IMPORT_FILE || ".local/operations.json";
  if (!file || file.includes("\0")) throw new Error("OPERATION_IMPORT_FAILED");
  return { apply, file };
}
export function assertSafeOperationImportDatabase(databaseUrl: string | undefined, allowNonLocal: string | undefined) {
  if (!databaseUrl) throw new Error("OPERATION_IMPORT_FAILED");
  let host: string; try { host = new URL(databaseUrl).hostname; } catch { throw new Error("OPERATION_IMPORT_FAILED"); }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && allowNonLocal !== "true") throw new Error("OPERATION_IMPORT_FAILED");
}
export function parseOperationImportSource(source: string): OperationImportEntry[] {
  if (Buffer.byteLength(source) > MAX_BYTES) throw new Error("OPERATION_IMPORT_FAILED");
  let payload: unknown; try { payload = JSON.parse(source); } catch { throw new Error("OPERATION_IMPORT_FAILED"); }
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { operations?: unknown }).operations : undefined;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error("OPERATION_IMPORT_FAILED");
  return rows.map(value => normalizeOperation(value)).filter((value): value is OperationImportEntry => value !== null);
}
function normalizeOperation(value: unknown): OperationImportEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>, operationId = normalizeLegacyOperationText(raw.operationId), companyName = normalizeLegacyOperationText(raw.companyName);
  let courseName = normalizeLegacyOperationText(raw.courseName); const courseId = normalizeLegacyOperationText(raw.courseId);
  if (!operationId || !companyName) throw new Error("OPERATION_IMPORT_FAILED");
  const validationErrors = Array.isArray(raw.validationErrors) ? raw.validationErrors.filter((item): item is string => typeof item === "string") : [];
  if (!courseName) { courseName = "과정명 미확인"; if (!validationErrors.includes("과정명 누락")) validationErrors.push("과정명 누락"); }
  const startDate = exactDateText(raw.startDate), endDate = exactDateText(raw.endDate);
  const clean = JSON.parse(JSON.stringify(raw)) as Record<string, Prisma.JsonValue>;
  return { ...clean, operationId, companyName, courseName, courseId, startDate, endDate, validationErrors };
}
function exactDateText(value: unknown) {
  const text = normalizeLegacyOperationText(value), match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("OPERATION_IMPORT_FAILED");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== text) throw new Error("OPERATION_IMPORT_FAILED");
  return text;
}
interface Dependencies { readSource(file: string): Promise<string>; getDefaultRepository(): OperationImportRepository; closeDefaultRepository(): Promise<void>; }
const defaults: Dependencies = { readSource: file => readFile(path.resolve(process.cwd(), file), "utf8"), getDefaultRepository: getOperationImportRepository, closeDefaultRepository: disconnectPrismaClient };
export async function runOperationImportCommand(args: string[], env: Record<string, string | undefined>, loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  let options = parseOperationImportArgs(args, env); const scoped = getDataRepositoryOverride("operationImport");
  let result: Awaited<ReturnType<OperationImportRepository["importOperations"]>> | undefined, failed = false, completed = false, cleanupFailed = false;
  try {
    if (!scoped) { loadEnvironment(); options = parseOperationImportArgs(args, env); assertSafeOperationImportDatabase(process.env.DATABASE_URL, process.env.ALLOW_NON_LOCAL_OPERATION_IMPORT); }
    const entries = parseOperationImportSource(await dependencies.readSource(options.file));
    result = await (scoped ?? dependencies.getDefaultRepository()).importOperations(entries, path.basename(options.file), options.apply); completed = true;
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { cleanupFailed = true; } }
  if (completed && cleanupFailed) throw new Error("OPERATION_IMPORT_CLEANUP_FAILED");
  if (failed || cleanupFailed || !result) throw new Error("OPERATION_IMPORT_FAILED");
  return { options, result };
}
