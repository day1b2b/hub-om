// 강사위키 강사별 값 읽기/저장 진입점.
// 실제 저장소는 instructorNoteRepositoryFactory가 고른다(로컬 dev = .local 파일, 배포 = PostgreSQL).
// 화면·API는 이 모듈만 import하면 되고 어느 저장소인지 알 필요가 없다.
import { getInstructorNoteRepository } from "./instructorNoteRepositoryFactory";

export type { InstructorNote, InstructorNotionProfile } from "./instructorNoteRepository";
import type { InstructorNote } from "./instructorNoteRepository";

export function getInstructorNote(name: string): Promise<InstructorNote> {
  return getInstructorNoteRepository().getNote(name);
}

// 목록 화면용: 전체 저장값(섭외지양 표시 등에 사용).
export function getAllInstructorNotes(): Promise<Record<string, InstructorNote>> {
  return getInstructorNoteRepository().getAllNotes();
}

// 부분 필드만 병합 저장(섭외지양 토글, 폼 저장이 각각 일부만 보낼 수 있음).
export function saveInstructorNote(name: string, patch: InstructorNote): Promise<InstructorNote> {
  return getInstructorNoteRepository().saveNote(name, patch);
}

// 노션 고유 ID(또는 전체 URL) → 열 수 있는 노션 URL. 전체 URL이면 그대로, 아니면 id로 구성.
export function notionHref(idOrUrl: string | undefined): string | null {
  const value = (idOrUrl ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const id = value.replace(/-/g, "");
  return `https://www.notion.so/${id}`;
}
