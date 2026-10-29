import type { InstructorNote } from "./instructorNoteRepository";
/** 암호화 저장할 강사 개인정보(노션/로컬 원천에서 strip 전에 추출). instructor_private_profiles에 적재. */
export interface InstructorPrivateImportFields {
  contact?: string;
  contact2?: string;
  email?: string;
  email2?: string;
  birthDate?: string;
}
export interface InstructorNoteImportEntry { name: string; note: InstructorNote; privateProfile?: InstructorPrivateImportFields; }
export interface InstructorNoteImportResult { total: number; inserted: number; updated: number; }
export interface InstructorNoteImportRepository { importNotes(entries: readonly InstructorNoteImportEntry[], apply: boolean): Promise<InstructorNoteImportResult>; }
