import { decryptDraft, encryptDraft, type BrowserDraftScope } from "./browserDraftCrypto";
import { IndexedDbAccountDraftStore, type AccountDraftStore } from "./accountDraftStore";

export type DraftSessionSnapshot = Readonly<{ status: "locked" | "loading" | "ready" | "error"; ownerId: string | null; generation: number }>;
export class DraftLockedError extends Error {
  constructor() { super("초안 잠금이 해제되지 않았습니다. 온라인에서 본인 계정으로 로그인한 뒤 다시 시도해주세요."); this.name = "DraftLockedError"; }
}
export type DraftKeyringResponse = { version: 1; subject: string; ownerId: string; activeKeyId: string; keys: Array<{ keyId: string; keyBase64: string }> };
const INITIAL: DraftSessionSnapshot = Object.freeze({ status: "locked", ownerId: null, generation: 0 });
const keyIdValid = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id);
function boundScope(scope: BrowserDraftScope, keyId: string): BrowserDraftScope {
  // Includes key version in authenticated context while reusing the tested AES-GCM primitive.
  return { ...scope, kind: JSON.stringify(["account-draft", 2, keyId, scope.kind]) };
}
export class BrowserDraftRuntime {
  private snapshot: DraftSessionSnapshot = INITIAL;
  private keys = new Map<string, CryptoKey>();
  private activeKeyId = "";
  private subject: string | null = null;
  private listeners = new Set<() => void>();
  private queues = new Map<string, Promise<unknown>>();
  private readonly storage: AccountDraftStore;
  private readonly request: typeof fetch;
  constructor(storage: AccountDraftStore = new IndexedDbAccountDraftStore(), request: typeof fetch = (...args) => fetch(...args)) { this.storage = storage; this.request = request; }
  getSnapshot = (): DraftSessionSnapshot => this.snapshot;
  getSubject = (): string | null => this.snapshot.status === "ready" ? this.subject : null;
  getServerSnapshot = (): DraftSessionSnapshot => INITIAL;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(status: DraftSessionSnapshot["status"], ownerId: string | null, generation: number) {
    this.snapshot = Object.freeze({ status, ownerId, generation });
    this.listeners.forEach(listener => listener());
  }
  lock(): void {
    this.keys.clear(); this.activeKeyId = ""; this.subject = null;
    this.emit("locked", null, this.snapshot.generation + 1);
  }
  async unlock(subject: string): Promise<void> {
    if (!subject || !subject.startsWith("google:")) { this.lock(); throw new DraftLockedError(); }
    if (this.snapshot.status === "ready" && this.subject === subject) return;
    this.keys.clear(); this.activeKeyId = ""; this.subject = subject;
    const generation = this.snapshot.generation + 1;
    this.emit("loading", null, generation);
    try {
      const response = await this.request("/api/browser-drafts/keyring", { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new DraftLockedError();
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") throw new DraftLockedError();
      const ring = body as DraftKeyringResponse;
      if (ring.version !== 1 || ring.subject !== subject || !/^bdo1_[A-Za-z0-9_-]{43}$/.test(ring.ownerId) || !keyIdValid(ring.activeKeyId) ||
        !Array.isArray(ring.keys) || !ring.keys.length || ring.keys.length > 8) throw new DraftLockedError();
      const imported = new Map<string, CryptoKey>();
      for (const item of ring.keys) {
        if (!item || !keyIdValid(item.keyId) || imported.has(item.keyId) || typeof item.keyBase64 !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(item.keyBase64)) throw new DraftLockedError();
        const raw = Uint8Array.from(atob(item.keyBase64), character => character.charCodeAt(0));
        if (raw.length !== 32) throw new DraftLockedError();
        try { imported.set(item.keyId, await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])); }
        finally { raw.fill(0); item.keyBase64 = ""; }
      }
      if (!imported.has(ring.activeKeyId) || this.snapshot.generation !== generation || this.subject !== subject) throw new DraftLockedError();
      this.keys = imported; this.activeKeyId = ring.activeKeyId;
      this.emit("ready", ring.ownerId, generation);
    } catch {
      if (this.snapshot.generation === generation) { this.keys.clear(); this.emit("error", null, generation); }
      throw new DraftLockedError();
    }
  }
  private capture(kind: string, id: string) {
    if (this.snapshot.status !== "ready" || !this.snapshot.ownerId) throw new DraftLockedError();
    if (!kind || !id || kind.length > 1024 || id.length > 1024) throw new Error("Invalid draft scope.");
    const generation = this.snapshot.generation;
    const scope = { owner: this.snapshot.ownerId, kind, operationId: id };
    const current = () => this.snapshot.status === "ready" && this.snapshot.generation === generation && this.snapshot.ownerId === scope.owner;
    return { scope, current, activeKeyId: this.activeKeyId };
  }
  private queue<T>(scope: BrowserDraftScope, run: () => Promise<T>): Promise<T> {
    const id = JSON.stringify(scope), previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    this.queues.set(id, next);
    void next.then(() => { if (this.queues.get(id) === next) this.queues.delete(id); }, () => { if (this.queues.get(id) === next) this.queues.delete(id); });
    return next;
  }
  async read<T>(kind: string, id: string): Promise<T | null> {
    const { scope, current } = this.capture(kind, id);
    return this.queue(scope, async () => {
      if (!current()) throw new DraftLockedError();
      const stored = await this.storage.read(scope);
      if (!current()) throw new DraftLockedError();
      if (!stored) return null;
      const key = this.keys.get(stored.keyId);
      if (!key) throw new DraftLockedError();
      const value = await decryptDraft<T>(key, boundScope(scope, stored.keyId), stored.envelope);
      if (!current()) throw new DraftLockedError();
      return value;
    });
  }
  async readVersioned<T>(kind: string, id: string): Promise<{ value: T | null; revision: string | null }> {
    const { scope, current } = this.capture(kind, id);
    return this.queue(scope, async () => {
      if (!current()) throw new DraftLockedError();
      const stored = await this.storage.read(scope);
      if (!current()) throw new DraftLockedError();
      if (!stored) return { value: null, revision: null };
      const key = this.keys.get(stored.keyId);
      if (!key) throw new DraftLockedError();
      const value = await decryptDraft<T>(key, boundScope(scope, stored.keyId), stored.envelope);
      if (!current()) throw new DraftLockedError();
      return { value, revision: JSON.stringify(stored) };
    });
  }
  async writeIfUnchanged(kind: string, id: string, value: unknown, expectedRevision: string | null): Promise<string> {
    const { scope, current, activeKeyId } = this.capture(kind, id);
    const payload = structuredClone(value);
    return this.queue(scope, async () => {
      const key = this.keys.get(activeKeyId);
      if (!current() || !key) throw new DraftLockedError();
      const envelope = await encryptDraft(key, boundScope(scope, activeKeyId), payload);
      if (!current()) throw new DraftLockedError();
      const stored = { version: 2 as const, keyId: activeKeyId, envelope };
      await this.storage.write(scope, stored, current, expectedRevision);
      if (!current()) throw new DraftLockedError();
      return JSON.stringify(stored);
    });
  }
  async removeIfUnchanged(kind: string, id: string, expectedRevision: string | null): Promise<void> {
    const { scope, current } = this.capture(kind, id);
    return this.queue(scope, async () => {
      if (!current()) throw new DraftLockedError();
      await this.storage.remove(scope, current, expectedRevision);
      if (!current()) throw new DraftLockedError();
    });
  }
  async write(kind: string, id: string, value: unknown): Promise<void> {
    const { scope, current, activeKeyId } = this.capture(kind, id);
    // Snapshot caller input before waiting behind an older write.
    const payload = structuredClone(value);
    return this.queue(scope, async () => {
      const key = this.keys.get(activeKeyId);
      if (!current() || !key) throw new DraftLockedError();
      const envelope = await encryptDraft(key, boundScope(scope, activeKeyId), payload);
      if (!current()) throw new DraftLockedError();
      await this.storage.write(scope, { version: 2, keyId: activeKeyId, envelope }, current);
      if (!current()) throw new DraftLockedError();
    });
  }
  async remove(kind: string, id: string): Promise<void> {
    const { scope, current } = this.capture(kind, id);
    return this.queue(scope, async () => {
      if (!current()) throw new DraftLockedError();
      await this.storage.remove(scope, current);
      if (!current()) throw new DraftLockedError();
    });
  }
}
export const browserDrafts = new BrowserDraftRuntime();
const LOCK_EPOCH = "hub-om:draft-lock-epoch:v2";
let channel: BroadcastChannel | undefined;
let observedEpoch: string | null = null;
let connected = false;
/** Only a random invalidation marker crosses tabs. No account identity, key, or draft contents. */
export function connectDraftLockEvents(): () => void {
  if (typeof window === "undefined" || connected) return () => {};
  connected = true;
  try { observedEpoch = window.localStorage.getItem(LOCK_EPOCH); } catch { /* Broadcast still works. */ }
  const receive = () => { browserDrafts.lock(); };
  const storage = (event: StorageEvent) => { if (event.key === LOCK_EPOCH) { observedEpoch = event.newValue; receive(); } };
  const focus = () => {
    try { const epoch = window.localStorage.getItem(LOCK_EPOCH); if (epoch !== observedEpoch) { observedEpoch = epoch; receive(); } }
    catch { /* Never save plaintext when storage is unavailable. */ }
  };
  if (typeof BroadcastChannel !== "undefined") { channel = new BroadcastChannel("hub-om:draft-lock:v2"); channel.onmessage = receive; }
  window.addEventListener("storage", storage); window.addEventListener("focus", focus); window.addEventListener("pageshow", focus);
  return () => { channel?.close(); channel = undefined; connected = false; window.removeEventListener("storage", storage); window.removeEventListener("focus", focus); window.removeEventListener("pageshow", focus); };
}
export function lockBrowserDrafts(): void {
  browserDrafts.lock();
  if (typeof window === "undefined") return;
  observedEpoch = crypto.randomUUID();
  try { window.localStorage.setItem(LOCK_EPOCH, observedEpoch); } catch { /* Broadcast is the second transport. */ }
  channel?.postMessage({ type: "lock" });
}
