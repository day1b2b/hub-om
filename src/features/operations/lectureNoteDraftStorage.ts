import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { blankTab, type LectureNoteTab } from "./lectureNoteModel";

export type NoteMode = "text" | "link";
export interface StoredDraft {
  linkDraft: string;
  mode: NoteMode;
  tabs: LectureNoteTab[];
  updatedAt: string;
}
export interface LectureDraftPort {
  read<T>(kind: string, id: string): Promise<T | null>;
  write(kind: string, id: string, value: unknown): Promise<void>;
  remove(kind: string, id: string): Promise<void>;
}
export const lectureLegacyDraftKey = (operationId: string) => `hub-om:lecture-note-draft:${operationId}`;

export function validateLectureDraft(value: unknown): StoredDraft {
  if (!value || typeof value !== "object") throw new Error("강의관리 초안 형식을 확인할 수 없습니다.");
  const parsed = value as Partial<StoredDraft>;
  if (!Array.isArray(parsed.tabs) || typeof parsed.updatedAt !== "string" || typeof parsed.linkDraft !== "string" || !["text", "link"].includes(parsed.mode ?? "")) throw new Error("강의관리 초안 형식을 확인할 수 없습니다.");
  const tabs = parsed.tabs.map(tab => {
    if (!tab || typeof tab !== "object") throw new Error("강의관리 초안 형식을 확인할 수 없습니다.");
    const defaults = blankTab();
    for (const [field, defaultValue] of Object.entries(defaults)) {
      const stored = tab[field as keyof LectureNoteTab];
      if (stored !== undefined && typeof defaultValue === "string" && typeof stored !== "string") throw new Error("강의관리 초안 형식을 확인할 수 없습니다.");
    }
    if (tab.issueTags !== undefined && (!Array.isArray(tab.issueTags) || !tab.issueTags.every(tag => typeof tag === "string"))) throw new Error("강의관리 초안 형식을 확인할 수 없습니다.");
    return { ...defaults, ...tab };
  });
  return { linkDraft: parsed.linkDraft, mode: parsed.mode as NoteMode, tabs, updatedAt: parsed.updatedAt };
}
export async function readDraft(operationId: string, storage: LectureDraftPort = browserDrafts): Promise<StoredDraft | null> {
  const value = await storage.read<unknown>("lecture-note", operationId);
  return value === null ? null : validateLectureDraft(value);
}
export async function writeDraft(operationId: string, draft: StoredDraft, storage: LectureDraftPort = browserDrafts): Promise<boolean> {
  try { await storage.write("lecture-note", operationId, validateLectureDraft(draft)); return true; }
  catch { return false; }
}
export async function clearDraft(operationId: string, storage: LectureDraftPort = browserDrafts): Promise<void> {
  await storage.remove("lecture-note", operationId);
}
