import { assertDraftEnvelope, type BrowserDraftEnvelope, type BrowserDraftScope } from "./browserDraftCrypto";

export type AccountDraftRecord = { version: 2; keyId: string; envelope: BrowserDraftEnvelope };
export function assertAccountDraftRecord(value: unknown): asserts value is AccountDraftRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid encrypted draft.");
  const row = value as AccountDraftRecord;
  if (Object.keys(row).sort().join(",") !== "envelope,keyId,version" || row.version !== 2 ||
    typeof row.keyId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(row.keyId)) throw new Error("Invalid encrypted draft.");
  assertDraftEnvelope(row.envelope);
}
export class DraftConflictError extends Error {
  constructor() { super("Encrypted draft changed in another writer."); this.name = "DraftConflictError"; }
}
export interface AccountDraftStore {
  // CAS revision: undefined = unconditional, null = missing, string = full persisted record JSON.
  read(scope: BrowserDraftScope): Promise<AccountDraftRecord | null>;
  write(scope: BrowserDraftScope, record: AccountDraftRecord, current: () => boolean, expectedRevision?: string | null): Promise<void>;
  remove(scope: BrowserDraftScope, current: () => boolean, expectedRevision?: string | null): Promise<void>;
}
function scopeKey(scope: BrowserDraftScope): string {
  if (![scope.owner, scope.kind, scope.operationId].every(v => typeof v === "string" && v.length > 0 && v.length <= 1024)) throw new Error("Invalid draft scope.");
  return JSON.stringify([scope.owner, scope.kind, scope.operationId]);
}

/** Product storage contains only opaque scopes and authenticated ciphertext. No keys or identity labels. */
export class IndexedDbAccountDraftStore implements AccountDraftStore {
  private connection?: Promise<IDBDatabase>;
  private readonly options: { indexedDB?: IDBFactory; databaseName?: string };
  constructor(options: { indexedDB?: IDBFactory; databaseName?: string } = {}) { this.options = options; }
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.options.indexedDB ?? globalThis.indexedDB;
      if (!factory) { reject(new Error("Encrypted draft storage unavailable.")); return; }
      const request = factory.open(this.options.databaseName ?? "hub-om-account-drafts-v2", 1);
      let blocked = false;
      request.onupgradeneeded = () => { request.result.createObjectStore("drafts"); };
      request.onerror = () => reject(new Error("Encrypted draft storage unavailable."));
      request.onblocked = () => { blocked = true; reject(new Error("Close older draft tabs and retry.")); };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); this.connection = undefined; };
        resolve(request.result);
      };
    });
    this.connection = pending;
    void pending.catch(() => { if (this.connection === pending) this.connection = undefined; });
    return pending;
  }
  private async run(scope: BrowserDraftScope, mode: IDBTransactionMode, value?: AccountDraftRecord | null, current = () => true, expectedRevision?: string | null): Promise<unknown> {
    const id = scopeKey(scope);
    if (expectedRevision !== undefined && expectedRevision !== null && typeof expectedRevision !== "string") throw new Error("Invalid draft revision.");
    // Validate and copy before the first await: a caller cannot mutate a queued write.
    const stored = value == null ? value : structuredClone(value);
    if (stored) assertAccountDraftRecord(stored);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction("drafts", mode, mode === "readwrite" ? { durability: "strict" } : undefined); }
      catch { reject(new Error("Encrypted draft storage unavailable.")); return; }
      let result: unknown;
      let failure: Error | undefined;
      const abort = (error?: Error) => {
        failure = error ?? new Error("Encrypted draft storage did not commit.");
        try { tx.abort(); } catch { reject(failure); }
      };
      tx.oncomplete = () => failure ? reject(failure) : resolve(result);
      tx.onabort = () => reject(failure ?? new Error("Encrypted draft storage did not commit."));
      tx.onerror = () => {};
      try {
        if (!current() || (mode === "readwrite" && tx.durability !== "strict")) { abort(); return; }
        const store = tx.objectStore("drafts");
        const mutate = () => {
          try {
            if (!current()) { abort(); return; }
            const request = stored === null ? store.delete(id) : store.put(stored, id);
            request.onsuccess = () => {
              try { result = request.result; if (!current()) abort(); }
              catch { abort(); }
            };
          } catch { abort(); }
        };
        if (mode === "readwrite" && expectedRevision === undefined) { mutate(); return; }
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            if (!current()) { abort(); return; }
            if (mode === "readonly") { result = request.result; return; }
            // get and put/delete share one strict transaction; competing writers
            // cannot commit between the revision comparison and mutation.
            const actual = request.result === undefined ? null : JSON.stringify(request.result);
            if (actual !== expectedRevision) { abort(new DraftConflictError()); return; }
            mutate();
          } catch { abort(); }
        };
      } catch { abort(); }
    });
  }
  async read(scope: BrowserDraftScope): Promise<AccountDraftRecord | null> {
    const result = await this.run(scope, "readonly");
    if (result === undefined) return null;
    assertAccountDraftRecord(result);
    return result;
  }
  async write(scope: BrowserDraftScope, record: AccountDraftRecord, current: () => boolean, expectedRevision?: string | null): Promise<void> { await this.run(scope, "readwrite", record, current, expectedRevision); }
  async remove(scope: BrowserDraftScope, current: () => boolean, expectedRevision?: string | null): Promise<void> { await this.run(scope, "readwrite", null, current, expectedRevision); }
}
