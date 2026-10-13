/** Never return source keys or values to presentation code. */
export const LEGACY_DRAFT_PREFIXES = [
  "hub-om:lecture-note-draft:",
  "hub-om:issue-review-draft:",
  "hub-om:drive-import-draft:",
  "hub-om:operation-submission:v1:",
] as const;
export type LegacyStorageKind = "localStorage" | "sessionStorage";
export type LegacyStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type LegacyStorageAccess = (kind: LegacyStorageKind) => LegacyStorage;
export const browserLegacyStorage: LegacyStorageAccess = kind => window[kind];
export const LEGACY_REGISTRATION_UNRESOLVED = "hub-om:legacy-registration-unresolved:v1";
export function isLegacyRegistrationKey(key: string): boolean { return key.startsWith(LEGACY_DRAFT_PREFIXES[3]); }
export function legacyDraftKeys(storage: Pick<Storage, "length" | "key">): string[] {
  const result = new Set<string>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && LEGACY_DRAFT_PREFIXES.some(prefix => key.startsWith(prefix))) result.add(key);
  }
  return [...result];
}
export type LegacyDraftCounts = { localStorage: number; sessionStorage: number; unavailable: boolean };
export function countLegacyDrafts(access: LegacyStorageAccess = browserLegacyStorage): LegacyDraftCounts {
  const result: LegacyDraftCounts = { localStorage: 0, sessionStorage: 0, unavailable: false };
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try { result[kind] = legacyDraftKeys(access(kind)).length; }
    catch { result.unavailable = true; }
  }
  return result;
}
export const LEGACY_DRAFT_LABELS = ["강의 노트", "이슈 회고", "드라이브 가져오기", "과정 등록"] as const;
/** Per-kind totals across both storages, aligned with LEGACY_DRAFT_LABELS. */
export function countLegacyDraftsByKind(access: LegacyStorageAccess = browserLegacyStorage): number[] {
  const result = LEGACY_DRAFT_PREFIXES.map(() => 0);
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      for (const key of legacyDraftKeys(access(kind))) result[LEGACY_DRAFT_PREFIXES.findIndex(prefix => key.startsWith(prefix))]++;
    } catch { /* countLegacyDrafts reports unavailability. */ }
  }
  return result;
}
