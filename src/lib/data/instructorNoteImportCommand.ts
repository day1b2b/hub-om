import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { disconnectPrismaClient } from "./prisma";
import { stripPiiFromNote } from "./instructorNotePii";
import { decodePrivateJson } from "../privacy/crypto";
import type { InstructorNote } from "./instructorNoteRepository";
import type { InstructorNoteImportRepository } from "./instructorNoteImportRepository";
import { getInstructorNoteImportRepository } from "./instructorNoteImportRepositoryFactory";
const MAX_SOURCE_BYTES = 32 * 1024 * 1024, MAX_ENTRIES = 20_000;
export function parseInstructorNoteImportArgs(args: string[]) { const allowed = new Set(["--dry-run", "--apply", "--backup-confirmed", "--maintenance-confirmed"]);
  if (args.some(arg => !allowed.has(arg)) || args.includes("--dry-run") && args.includes("--apply")) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED"); const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED"); return { apply }; }
function parseSource(source: string) { if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED"); const raw: unknown = decodePrivateJson(source.trimEnd(), "local:instructor-wiki");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED"); const items = Object.entries(raw);
  if (items.length > MAX_ENTRIES || items.some(([key, note]) => !key.trim() || !note || typeof note !== "object" || Array.isArray(note))) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED");
  const notionNos = new Set<number>();
  return items.map(([key, value]) => {
    const note = stripPiiFromNote(value as InstructorNote), numericKey = /^\d+$/.test(key) ? Number(key) : undefined;
    const notionNo = note.notionNo;
    if (notionNo !== undefined && (!Number.isInteger(notionNo) || notionNo < -2147483648 || notionNo > 2147483647 || notionNos.has(notionNo))) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED");
    if (notionNo !== undefined) notionNos.add(notionNo);
    if (numericKey !== undefined && (notionNo === undefined || numericKey !== notionNo)) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED");
    const name = note.instructorName?.trim() || (numericKey === undefined ? key : "");
    if (!name) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED");
    return { name, note: { ...note, instructorName: name } };
  }); }
interface Dependencies { readSource(): Promise<string>; getDefaultRepository(): InstructorNoteImportRepository; closeDefaultRepository(): Promise<void>; }
const defaults: Dependencies = { readSource: () => readFile(path.join(process.cwd(), ".local", "instructor-wiki.json"), "utf8"), getDefaultRepository: getInstructorNoteImportRepository, closeDefaultRepository: disconnectPrismaClient };
export async function runInstructorNoteImportCommand(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const options = parseInstructorNoteImportArgs(args), scoped = getDataRepositoryOverride("instructorNoteImport"); let result: { total: number; inserted: number; updated: number } | undefined, failed = false;
  try { if (!scoped) loadEnvironment(); const entries = parseSource(await dependencies.readSource()); result = await (scoped ?? dependencies.getDefaultRepository()).importNotes(entries, options.apply); }
  catch { failed = true; } finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { failed = true; } }
  if (failed || !result) throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED"); return { options, result };
}
