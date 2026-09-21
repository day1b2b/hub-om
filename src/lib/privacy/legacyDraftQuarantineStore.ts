import { isLegacyDraftQuarantineRecord, type LegacyDraftQuarantineRecord } from "./legacyDraftQuarantine";

export interface LegacyQuarantineStore {
  add(record: LegacyDraftQuarantineRecord): Promise<void>;
  read(id: string): Promise<LegacyDraftQuarantineRecord | null>;
  count(): Promise<number>;
}
const failure = () => new Error("격리 보관함 저장을 확인하지 못했습니다. 원문을 유지합니다.");
/** Append-only: no update/delete API. Source keys, contents and identity never become IDB keys. */
export class IndexedDbLegacyQuarantineStore implements LegacyQuarantineStore {
  private connection?: Promise<IDBDatabase>;
  private readonly options: { indexedDB?: IDBFactory; databaseName?: string };
  constructor(options: { indexedDB?: IDBFactory; databaseName?: string } = {}) { this.options = options; }
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = (this.options.indexedDB ?? globalThis.indexedDB).open(this.options.databaseName ?? "hub-om-legacy-quarantine-v1", 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("records");
      request.onerror = () => reject(failure());
      request.onblocked = () => { blocked = true; reject(failure()); };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.connection = undefined; };
        resolve(db);
      };
    });
    this.connection = pending;
    void pending.catch(() => { if (this.connection === pending) this.connection = undefined; });
    return pending;
  }
  private async run(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction("records", mode, mode === "readwrite" ? { durability: "strict" } : undefined); }
      catch { reject(failure()); return; }
      let result: unknown, succeeded = false;
      tx.oncomplete = () => succeeded ? resolve(result) : reject(failure());
      tx.onabort = () => reject(failure());
      tx.onerror = () => {};
      try {
        if (mode === "readwrite" && tx.durability !== "strict") throw failure();
        const request = action(tx.objectStore("records"));
        request.onsuccess = () => { succeeded = true; result = request.result; };
      } catch { try { tx.abort(); } catch { reject(failure()); } }
    });
  }
  async add(record: LegacyDraftQuarantineRecord): Promise<void> {
    if (!isLegacyDraftQuarantineRecord(record)) throw failure();
    const snapshot = structuredClone(record);
    await this.run("readwrite", store => store.add(snapshot, snapshot.envelope.id));
  }
  async read(id: string): Promise<LegacyDraftQuarantineRecord | null> {
    const record = await this.run("readonly", store => store.get(id));
    if (record === undefined) return null;
    if (!isLegacyDraftQuarantineRecord(record)) throw failure();
    return record as LegacyDraftQuarantineRecord;
  }
  async count(): Promise<number> { return await this.run("readonly", store => store.count()) as number; }
}
