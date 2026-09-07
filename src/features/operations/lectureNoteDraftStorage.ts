import { blankTab, type LectureNoteTab } from "./lectureNoteModel";

export type NoteMode = "text" | "link";
export interface StoredDraft {
  linkDraft: string;
  mode: NoteMode;
  tabs: LectureNoteTab[];
  updatedAt: string;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const DRAFT_STORAGE_PREFIX = "hub-om:lecture-note-draft:";

// 미저장 기록은 기간과 무관하게 보존한다. 서버 저장 확인 또는 명시적인 버리기로만 삭제한다.
function draftStorageKey(operationId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${operationId}`;
}

export function readDraft(operationId: string, storage?: DraftStorage): StoredDraft | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(draftStorageKey(operationId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!Array.isArray(parsed.tabs) || typeof parsed.updatedAt !== "string") return null;

    return {
      linkDraft: typeof parsed.linkDraft === "string" ? parsed.linkDraft : "",
      mode: parsed.mode === "link" ? "link" : "text",
      tabs: parsed.tabs.map((tab) => ({ ...blankTab(), ...tab })),
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

export function writeDraft(operationId: string, draft: StoredDraft, storage?: DraftStorage): boolean {
  try {
    const target = storage ?? window.localStorage;
    const key = draftStorageKey(operationId);
    const serialized = JSON.stringify(draft);
    target.setItem(key, serialized);
    return target.getItem(key) === serialized;
  } catch {
    // 서버 저장은 계속 시도하되, 닫기에서는 보관 실패를 확인해 입력을 보호한다.
    return false;
  }
}

export function clearDraft(operationId: string, storage?: DraftStorage) {
  try {
    (storage ?? window.localStorage).removeItem(draftStorageKey(operationId));
  } catch {
    // 지우지 못해도 다음에 열 때 서버 값과 같으면 다시 정리된다.
  }
}

