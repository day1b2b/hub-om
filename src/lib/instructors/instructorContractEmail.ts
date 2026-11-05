// 강사 계약요청 확인 창을 열 때 그 강사 1명의 이메일을 노션 강사 정보(hub 암호화 저장본)에서 읽기 위한
// "운영 현황 강사 표기 → 노션 강사 노트 id" 해석. 순수 함수(I/O 없음).
// 틀린 사람의 이메일을 프리필하느니 비우는 편이 안전하므로, 한 명으로 확정될 때만 id를 돌려준다
// (동명이인·못 찾음 = null → 확인 창은 "비어 있음 · 폼에서 입력").
import type { InstructorNote } from "@/lib/data/instructorNoteRepository";
import { normalizeInstructorName } from "./instructorContractMatch";

export const CONTRACT_REQUEST_CONTEXT = "contract_request";

/**
 * notes: 강사 노트 전체, linkTargets: OM이 위키에서 지정한 수동 연결(운영 현황 표기 → 노션 강사명).
 * ① 수동 연결이 있으면 그 노션 강사명으로 ② 이름이 정확히 같은 노션 강사 ③ 소속 접두사 등을 뗀 정규화 이름이
 *    같은 노션 강사 — 각 단계에서 후보가 딱 1명일 때만 확정한다.
 */
export function resolveContractInstructorNoteId(
  notes: readonly InstructorNote[],
  linkTargets: Readonly<Record<string, string>>,
  instructorName: string
): string | null {
  const raw = instructorName.trim();
  if (!raw) return null;
  const notionNotes = notes.filter((note) => note.notionNo !== undefined && note.id && (note.instructorName ?? "").trim());
  const target = linkTargets[raw] ?? raw;

  const exact = notionNotes.filter((note) => (note.instructorName ?? "").trim() === target);
  if (exact.length === 1) return exact[0].id ?? null;
  if (exact.length > 1) return null;

  const normalized = normalizeInstructorName(target);
  if (!normalized) return null;
  const loose = notionNotes.filter((note) => normalizeInstructorName(note.instructorName ?? "") === normalized);
  return loose.length === 1 ? (loose[0].id ?? null) : null;
}
