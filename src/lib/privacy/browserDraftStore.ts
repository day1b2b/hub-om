import {
  assertDraftEnvelope, assertVaultEnvelope, decryptDraft, encryptDraft, unlockVault,
  type BrowserDraftEnvelope, type BrowserDraftScope, type BrowserDraftVaultEnvelope
} from "./browserDraftCrypto";

/** Prototype only. Callers supply opaque owner/scope identifiers, never names or emails. */
export interface BrowserDraftStore {
  createVault(owner: string, envelope: unknown): Promise<void>;
  readVault(owner: string): Promise<BrowserDraftVaultEnvelope | undefined>;
  writeDraft(scope: BrowserDraftScope, envelope: unknown, options?: { ifAbsent?: boolean }): Promise<void>;
  readDraft(scope: BrowserDraftScope): Promise<BrowserDraftEnvelope | undefined>;
  /** Atomically commits an immutable recovery and its unchanged vault with strict durability. */
  createRecovery(scope: BrowserDraftScope, envelope: unknown, expectedVault: unknown): Promise<void>;
  readRecovery(scope: BrowserDraftScope): Promise<BrowserDraftEnvelope | undefined>;
}

const STORE_VERSION = 2;
const VAULTS = "vaults";
const DRAFTS = "drafts";
const RECOVERIES = "recoveries";
const storageFailure = () => new Error("Encrypted browser draft storage failed.");
function snapshot(value: unknown): unknown {
  try { return structuredClone(value); }
  catch { throw storageFailure(); }
}
function ownerKey(owner: string): string {
  if (typeof owner !== "string" || !owner || owner.length > 1024) throw storageFailure();
  return owner;
}
function draftKey(scope: BrowserDraftScope): string {
  return JSON.stringify([ownerKey(scope.owner), ownerKey(scope.kind), ownerKey(scope.operationId)]);
}
function sameEnvelope(left: BrowserDraftEnvelope | BrowserDraftVaultEnvelope, right: BrowserDraftEnvelope | BrowserDraftVaultEnvelope): boolean {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

/** IndexedDB commits atomically; request success alone does not mean a write committed. */
export class IndexedDbDraftStore implements BrowserDraftStore {
  private readonly databaseName: string;
  private readonly factory: IDBFactory | undefined;
  private database: Promise<IDBDatabase> | undefined;

  constructor(options: { databaseName?: string; indexedDB?: IDBFactory } = {}) {
    this.databaseName = options.databaseName ?? "hub-om-private-drafts-v1";
    this.factory = options.indexedDB ?? globalThis.indexedDB;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.factory) { reject(storageFailure()); return; }
      let request: IDBOpenDBRequest;
      try { request = this.factory.open(this.databaseName, STORE_VERSION); }
      catch { reject(storageFailure()); return; }
      let abandoned = false;
      request.onblocked = () => { abandoned = true; reject(storageFailure()); };
      request.onerror = () => reject(storageFailure());
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(VAULTS)) db.createObjectStore(VAULTS);
          if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS);
          if (!db.objectStoreNames.contains(RECOVERIES)) db.createObjectStore(RECOVERIES);
        } catch { request.transaction?.abort(); }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.database = undefined; };
        resolve(db);
      };
    });
    this.database = pending;
    void pending.catch(() => { if (this.database === pending) this.database = undefined; });
    return pending;
  }

  private async transaction(stores: string | string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, done: (value: unknown) => void) => void): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : undefined); }
      catch { reject(storageFailure()); return; }
      let result: unknown;
      let requestSucceeded = false;
      tx.oncomplete = () => requestSucceeded ? resolve(result) : reject(storageFailure());
      tx.onabort = () => reject(storageFailure());
      // Request errors normally abort the transaction. Wait for its final outcome.
      tx.onerror = () => {};
      try {
        // Older engines may silently ignore the option. Never delete a legacy
        // source based on a write with unconfirmed durability support.
        if (mode === "readwrite" && tx.durability !== "strict") throw storageFailure();
        action(tx, value => { result = value; requestSucceeded = true; });
      } catch {
        try { tx.abort(); } catch { /* Already inactive. */ }
        reject(storageFailure());
      }
    });
  }

  private request(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    return this.transaction(store, mode, (tx, done) => {
      const request = action(tx.objectStore(store));
      request.onsuccess = () => done(request.result);
    });
  }

  async createVault(owner: string, envelope: unknown): Promise<void> {
    const key = ownerKey(owner);
    const stored = snapshot(envelope);
    assertVaultEnvelope(stored);
    // add, never put: an accidental vault replacement strands all existing drafts.
    await this.request(VAULTS, "readwrite", store => store.add(stored, key));
  }

  async readVault(owner: string): Promise<BrowserDraftVaultEnvelope | undefined> {
    const result = await this.request(VAULTS, "readonly", store => store.get(ownerKey(owner)));
    if (result !== undefined) assertVaultEnvelope(result);
    return result;
  }

  async writeDraft(scope: BrowserDraftScope, envelope: unknown, options: { ifAbsent?: boolean } = {}): Promise<void> {
    const key = draftKey(scope);
    const stored = snapshot(envelope);
    assertDraftEnvelope(stored);
    const ifAbsent = options.ifAbsent === true;
    await this.request(DRAFTS, "readwrite", store => ifAbsent ? store.add(stored, key) : store.put(stored, key));
  }

  async readDraft(scope: BrowserDraftScope): Promise<BrowserDraftEnvelope | undefined> {
    const key = draftKey(scope);
    const result = await this.request(DRAFTS, "readonly", store => store.get(key));
    if (result !== undefined) assertDraftEnvelope(result);
    return result;
  }

  async createRecovery(scope: BrowserDraftScope, envelope: unknown, expectedVault: unknown): Promise<void> {
    const key = draftKey(scope);
    const owner = ownerKey(scope.owner);
    const stored = snapshot(envelope);
    const vault = snapshot(expectedVault);
    assertDraftEnvelope(stored);
    assertVaultEnvelope(vault);
    await this.transaction([VAULTS, RECOVERIES], "readwrite", (tx, done) => {
      const vaults = tx.objectStore(VAULTS);
      const recoveries = tx.objectStore(RECOVERIES);
      const vaultRead = vaults.get(owner);
      vaultRead.onsuccess = () => {
        try {
          assertVaultEnvelope(vaultRead.result);
          if (!sameEnvelope(vaultRead.result, vault)) throw storageFailure();
          const recoveryRead = recoveries.get(key);
          recoveryRead.onsuccess = () => {
            try {
              const existing: unknown = recoveryRead.result;
              if (existing !== undefined) {
                assertDraftEnvelope(existing);
                if (!sameEnvelope(existing, stored)) throw storageFailure();
              }
              // Rewrite only the identical vault to flush pre-v2 relaxed vaults
              // in the same strict commit as the immutable recovery copy.
              vaults.put(vault, owner);
              if (existing === undefined) {
                const added = recoveries.add(stored, key);
                added.onsuccess = () => done(undefined);
              } else {
                // Existing recovery records were created by this strict API;
                // exact ciphertext retries are idempotent, never replacements.
                done(undefined);
              }
            } catch { tx.abort(); }
          };
        } catch { tx.abort(); }
      };
    });
  }

  async readRecovery(scope: BrowserDraftScope): Promise<BrowserDraftEnvelope | undefined> {
    const key = draftKey(scope);
    const result = await this.request(RECOVERIES, "readonly", store => store.get(key));
    if (result !== undefined) assertDraftEnvelope(result);
    return result;
  }

  close(): void {
    const pending = this.database;
    this.database = undefined;
    if (pending) void pending.then(db => db.close(), () => {});
  }
}

export type LegacyDraftStorage = Pick<Storage, "getItem" | "removeItem">;
export class LegacyDraftMigrationError extends Error {
  readonly code: "owner-unconfirmed" | "source-unavailable" | "vault-unavailable" | "invalid-json" | "destination-conflict" | "verification-failed" | "source-changed" | "source-removal-failed";
  constructor(code: LegacyDraftMigrationError["code"]) {
    super(`Legacy draft migration incomplete: ${code}.`);
    this.name = "LegacyDraftMigrationError";
    this.code = code;
  }
}

/**
 * Explicit confirmation must refer to this legacy item's owner, not merely the
 * current login. No owner is inferred from an unscoped localStorage key.
 * Unlocks only the committed owner vault, so an unpersisted ephemeral key can
 * never be used to delete the only recoverable copy of the source.
 * The source comparison/removal is synchronous, but localStorage has no cross-tab
 * CAS: callers must stop legacy writers before migration. Keys stay in memory.
 */
export async function migrateLegacyDraft(options: {
  store: BrowserDraftStore;
  storage: LegacyDraftStorage;
  legacyKey: string;
  scope: BrowserDraftScope;
  secret: string;
  confirmedOwner?: string;
}): Promise<{ status: "migrated" | "missing" }> {
  const { store, storage, legacyKey, secret } = options;
  const scope = { ...options.scope };
  if (!options.confirmedOwner || options.confirmedOwner !== scope.owner) throw new LegacyDraftMigrationError("owner-unconfirmed");
  draftKey(scope);
  let source: string | null;
  try { source = storage.getItem(legacyKey); }
  catch { throw new LegacyDraftMigrationError("source-unavailable"); }
  if (source === null) return { status: "missing" };
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new LegacyDraftMigrationError("invalid-json"); }
  let key: CryptoKey;
  let persistedVault: BrowserDraftVaultEnvelope;
  try {
    const storedVault = await store.readVault(scope.owner);
    if (storedVault === undefined) throw new Error();
    persistedVault = storedVault;
    key = await unlockVault(persistedVault, secret, scope.owner);
  } catch { throw new LegacyDraftMigrationError("vault-unavailable"); }
  const expected = JSON.stringify(value);
  const existing = await store.readDraft(scope);
  let migratedEnvelope: BrowserDraftEnvelope;
  if (existing === undefined) {
    const envelope = await encryptDraft(key, scope, value);
    // Atomic add handles a competing migration after the initial read.
    await store.writeDraft(scope, envelope, { ifAbsent: true });
    migratedEnvelope = envelope;
  } else {
    let same = false;
    try { same = JSON.stringify(await decryptDraft(key, scope, existing)) === expected; }
    catch { /* An unreadable existing draft must never be overwritten. */ }
    if (!same) throw new LegacyDraftMigrationError("destination-conflict");
    migratedEnvelope = existing;
  }
  try {
    // Ordinary draft writes remain mutable. Preserve an immutable copy before
    // awaiting verification so a concurrent put cannot erase the migrated value.
    const existingRecovery = await store.readRecovery(scope);
    if (existingRecovery !== undefined) {
      if (JSON.stringify(await decryptDraft(key, scope, existingRecovery)) !== expected) throw new Error();
      migratedEnvelope = existingRecovery;
    }
    await store.createRecovery(scope, migratedEnvelope, persistedVault);
    const persisted = await store.readRecovery(scope);
    if (persisted === undefined || JSON.stringify(await decryptDraft(key, scope, persisted)) !== expected) throw new Error();
  } catch { throw new LegacyDraftMigrationError("verification-failed"); }
  // No await between comparison and removal. Never delete after a failed commit
  // or verification; interrupted migrations can retry against the same ciphertext.
  try {
    if (storage.getItem(legacyKey) !== source) throw new LegacyDraftMigrationError("source-changed");
  } catch (error) {
    if (error instanceof LegacyDraftMigrationError) throw error;
    throw new LegacyDraftMigrationError("source-unavailable");
  }
  try {
    storage.removeItem(legacyKey);
    if (storage.getItem(legacyKey) !== null) throw new Error();
  } catch { throw new LegacyDraftMigrationError("source-removal-failed"); }
  return { status: "migrated" };
}
