import { isLegacyDraftQuarantineRecord, type LegacyDraftSnapshot, type LegacyDraftQuarantineRecord } from "./legacyDraftQuarantine";
import type { LegacyQuarantineStore } from "./legacyDraftQuarantineStore";
import { browserLegacyStorage, countLegacyDrafts, isLegacyRegistrationKey, legacyDraftKeys, LEGACY_REGISTRATION_UNRESOLVED, type LegacyStorageAccess } from "./legacyDraftSources";

export interface LegacyQuarantineService {
  seal(snapshot: LegacyDraftSnapshot): Promise<LegacyDraftQuarantineRecord>;
  verify(record: LegacyDraftQuarantineRecord, snapshot: LegacyDraftSnapshot): Promise<boolean>;
}
export function legacyQuarantineService(request: typeof fetch = fetch): LegacyQuarantineService {
  const post = async (route: string, body: unknown) => {
    const response = await request(`/api/browser-drafts/quarantine/${route}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("격리 검증을 완료하지 못했습니다.");
    return await response.json();
  };
  return {
    async seal(snapshot) {
      const result = await post("seal", { snapshot });
      if (!isLegacyDraftQuarantineRecord(result?.record)) throw new Error("격리 응답을 확인하지 못했습니다.");
      return result.record;
    },
    async verify(record, snapshot) {
      const result = await post("verify", { record, snapshot });
      return result?.verified === true && result.id === record.envelope.id && result.nonce === snapshot.nonce;
    },
  };
}
export const LEGACY_TRANSITION_LOCK = "hub-om:legacy-transition:v1";
/** Cooperating new clients only. This never proves old tabs/frames are stopped. */
export async function withLegacyTransitionLock<T>(run: () => Promise<T>, locks: LockManager | null | undefined = globalThis.navigator?.locks): Promise<T> {
  if (!locks) throw new Error("이 브라우저에서 안전한 전환 잠금을 사용할 수 없습니다. 원문을 유지합니다.");
  return locks.request(LEGACY_TRANSITION_LOCK, { mode: "exclusive" }, run);
}
export type LegacyTransitionResult = { copied: number; removed: number; changed: number; failed: number; remaining: ReturnType<typeof countLegacyDrafts> };

/** Caller holds the cooperating-client lock for any deletion. Local deletion additionally needs the operational single-writer confirmation. */
export async function transitionLegacyDrafts(options: {
  store: LegacyQuarantineStore;
  service: LegacyQuarantineService;
  access?: LegacyStorageAccess;
  current: () => boolean;
  removeSession: boolean;
  removeLocal: boolean;
}): Promise<LegacyTransitionResult> {
  const access = options.access ?? browserLegacyStorage;
  const result = { copied: 0, removed: 0, changed: 0, failed: 0, remaining: countLegacyDrafts(access) };
  const assertCurrent = () => { if (!options.current()) throw new Error("전환 세션이 변경되었습니다."); };
  for (const source of ["sessionStorage", "localStorage"] as const) {
    let keys: string[];
    try { keys = legacyDraftKeys(access(source)); } catch { result.failed++; continue; }
    for (const storageKey of keys) {
      // Preserve the previous encrypted copy and try the newly observed value once.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          assertCurrent();
          const storage = access(source);
          const rawValue = storage.getItem(storageKey);
          if (rawValue === null) break;
          const snapshot: LegacyDraftSnapshot = { version: 1, source, storageKey, rawValue, nonce: crypto.randomUUID() };
          const record = await options.service.seal(snapshot);
          assertCurrent();
          await options.store.add(record);
          assertCurrent();
          const readback = await options.store.read(record.envelope.id);
          if (!readback || JSON.stringify(readback) !== JSON.stringify(record)) throw new Error("격리 사본이 변경되었습니다.");
          if (!await options.service.verify(readback, snapshot)) throw new Error("격리 사본을 검증하지 못했습니다.");
          assertCurrent();
          result.copied++;
          if (storage.getItem(storageKey) !== rawValue) { result.changed++; continue; }
          if (!(source === "sessionStorage" ? options.removeSession : options.removeLocal)) break;
          // Keep registration ambiguity after removing its plaintext source. This marker is not an owner claim.
          if (isLegacyRegistrationKey(storageKey)) {
            const local = access("localStorage");
            local.setItem(LEGACY_REGISTRATION_UNRESOLVED, "1");
            if (local.getItem(LEGACY_REGISTRATION_UNRESOLVED) !== "1") throw new Error("등록 확인 표시를 보존하지 못했습니다.");
          }
          assertCurrent();
          // No await between compare and removal. localStorage is NOT CAS; the UI's old-writer exclusion is mandatory.
          if (storage.getItem(storageKey) !== rawValue) { result.changed++; continue; }
          storage.removeItem(storageKey);
          if (storage.getItem(storageKey) !== null) { result.changed++; continue; }
          result.removed++;
          break;
        } catch {
          result.failed++;
          if (!options.current()) { result.remaining = countLegacyDrafts(access); return result; }
          break;
        }
      }
    }
  }
  result.remaining = countLegacyDrafts(access);
  return result;
}

/** Explicit user decision to start afresh. Never restores or attaches the old submission. */
export async function acknowledgeLegacyRegistration(access: LegacyStorageAccess = browserLegacyStorage, current = () => true): Promise<void> {
  await withLegacyTransitionLock(async () => {
    if (!current()) throw new Error("전환 세션이 변경되었습니다.");
    if (["localStorage", "sessionStorage"].some(kind => legacyDraftKeys(access(kind as "localStorage" | "sessionStorage")).some(isLegacyRegistrationKey))) throw new Error("이전 등록 정보의 보호 절차를 먼저 완료해주세요.");
    const local = access("localStorage");
    local.removeItem(LEGACY_REGISTRATION_UNRESOLVED);
    if (local.getItem(LEGACY_REGISTRATION_UNRESOLVED) !== null) throw new Error("등록 확인 표시를 정리하지 못했습니다.");
  });
}
