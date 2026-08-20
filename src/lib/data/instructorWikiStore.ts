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

/**
 * 노션 ID 비교용 정규화. 저장값이 전체 URL일 수도, 대시가 있을 수도 있어 32자 hex만 남긴다.
 */
export function notionIdKey(idOrUrl: string | undefined): string {
  const value = (idOrUrl ?? "").trim().toLowerCase();
  if (!value) return "";
  const matches = value.replace(/-/g, "").match(/[0-9a-f]{32}/g);
  return matches ? matches[matches.length - 1] : "";
}

/**
 * OM이 수동 연결한 노션 강사 매핑을 뽑는다. 결과: 운영 현황 표기 → 노션 강사명.
 *
 * 노션 동기화가 만든 노트는 이름이 노션 강사명이고 notionId가 자기 페이지 ID다. 그래서
 * "notionId가 다른 노트의 이름을 가리키는" 경우만 수동 연결로 본다(자기 자신은 제외).
 */
export function resolveNotionLinkTargets(notes: Record<string, InstructorNote>): Record<string, string> {
  // 같은 노션 ID를 여러 노트가 갖고 있을 수 있다(예전에 연결하면서 스냅샷까지 복사된 경우).
  // 그때 정본은 동기화가 계속 갱신하는 쪽이므로 notion.syncedAt이 가장 최근인 노트를 고른다.
  // 동률이면 이름이 짧은 쪽 → 사전순으로 결정적으로 정한다.
  const ownerByNotionId = new Map<string, string>();
  for (const [name, note] of Object.entries(notes)) {
    if (!note?.notion) continue;
    const key = notionIdKey(note.notionId);
    if (!key) continue;

    const current = ownerByNotionId.get(key);
    if (current === undefined || preferOwner(notes, name, current)) {
      ownerByNotionId.set(key, name);
    }
  }

  const targets: Record<string, string> = {};
  for (const [name, note] of Object.entries(notes)) {
    const key = notionIdKey(note?.notionId);
    if (!key) continue;
    const target = ownerByNotionId.get(key);
    if (target && target !== name) targets[name] = target;
  }
  return targets;
}

/** candidate가 current보다 정본에 적합한가. */
function preferOwner(notes: Record<string, InstructorNote>, candidate: string, current: string): boolean {
  const a = notes[candidate]?.notion?.syncedAt ?? "";
  const b = notes[current]?.notion?.syncedAt ?? "";
  if (a !== b) return a > b;
  if (candidate.length !== current.length) return candidate.length < current.length;
  return candidate.localeCompare(current, "ko") < 0;
}
