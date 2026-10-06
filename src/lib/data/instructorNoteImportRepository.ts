import type { InstructorNote } from "./instructorNoteRepository";
export interface InstructorNoteImportEntry { name: string; note: InstructorNote; }
export interface InstructorNoteImportResult { total: number; inserted: number; updated: number; }
export interface InstructorNoteImportRepository { importNotes(entries: readonly InstructorNoteImportEntry[], apply: boolean): Promise<InstructorNoteImportResult>; }
