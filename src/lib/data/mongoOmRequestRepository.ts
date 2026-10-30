import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import policies from "../privacy/fields.json" with { type: "json" };
import type { OmRequestRepository } from "./omRequest/omRequestRepository";
import type { OmRequestInput } from "./omRequest/omRequestTypes";
import { toOmRequest, toInputData, type OmRequestRow } from "./omRequest/omRequestMapping";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument, MongoJsonNull } from "./mongoRuntimeCodec";

export const OM_REQUEST_MODELS = ["OmRequest", "ActivityChange"] as const;
export type MongoOmRequestOptions = MongoOperationOptions & { allowShadowWrites: true };
const fields = policies.OmRequest.fields as Record<string, { index?: string }>;
function uuid(value: string): string {
  assertMongo(typeof value === "string", "OM_REQUEST_INVALID_ID");
  const text = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  assertMongo(/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(text), "OM_REQUEST_INVALID_ID");
  const hex = text.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const defined = (values: MongoRow): MongoRow => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
function inputPatch(input: OmRequestInput): MongoRow {
  const values = toInputData(input);
  // Prisma's Int input conversion truncates finite fractional numbers toward zero.
  // Preserve that existing API behavior; codec still enforces the signed Int32 range.
  return { ...values, totalSessions: typeof values.totalSessions === "number" && Number.isFinite(values.totalSessions)
    ? Math.trunc(values.totalSessions) : values.totalSessions };
}
const dto = (row: MongoRow) => toOmRequest({ ...row, sessions: row.sessions === MongoJsonNull ? null : row.sessions } as unknown as OmRequestRow);
export async function prepareMongoOmRequestStore(options: MongoOmRequestOptions): Promise<void> {
  try { await prepareMongoReadStore(options, OM_REQUEST_MODELS); }
  catch { throw new MongoOperationError("OM_REQUEST_PREPARE_FAILED"); }
}

/** Only explicitly opened shadow stores. No automatic namespace repair or production selection. */
export class MongoOmRequestRepository implements OmRequestRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoOmRequestOptions): Promise<MongoOmRequestRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, OM_REQUEST_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoOmRequestRepository(store);
    } catch { throw new MongoOperationError("OM_REQUEST_OPEN_FAILED"); }
  }
  private async transaction<T>(work: (session: ClientSession, check: () => void) => Promise<T>): Promise<T> {
    const deadline = performance.now() + 30_000;
    const check = () => assertMongo(performance.now() < deadline, "OM_REQUEST_TIMEOUT");
    const session = this.store.client.startSession();
    try {
      assertPrivacyConfiguration();
      return await session.withTransaction(async () => { check(); const result = await work(session, check); check(); return result; }, {
        readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000
      });
    } catch { throw new MongoOperationError("OM_REQUEST_TRANSACTION_FAILED"); }
    finally { await session.endSession(); }
  }
  private async audit(before: MongoRow | null, after: MongoRow | null, session: ClientSession, written: MongoRow = {}): Promise<void> {
    // PG re-encrypts supplied JSON without a blind index; even identical sessions
    // therefore produce a redacted change. Scalar HMAC no-ops remain silent.
    const audit = operationAuditRow("OmRequest", before, after,
      before && after && Object.hasOwn(written, "sessions") ? ["sessions"] : []);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
  }
  async listOmRequests() {
    return this.transaction(async session => {
      const rows = await this.store.scan("OmRequest", {}, session);
      rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return rows.map(dto);
    });
  }
  async getOmRequest(rawId: string) {
    const id = uuid(rawId);
    return this.transaction(async session => { const row = await this.store.one("OmRequest", { _id: id }, session); return row ? dto(row) : null; });
  }
  async createOmRequest(input: OmRequestInput) {
    return this.transaction(async (session, check) => {
      const row = completeMongoRow("OmRequest", { id: randomUUID(), createdAt: new Date(), status: "배정필요", resultReportNeeded: "N", ...defined(inputPatch(input)) });
      const encoded = encodeMongoRuntimeDocument("OmRequest", row); check();
      await this.store.collection("OmRequest").insertOne(encoded, { session });
      await this.audit(null, row, session); return dto(row);
    });
  }
  private async patch(rawId: string, input: () => MongoRow) {
    const id = uuid(rawId);
    return this.transaction(async (session, check) => {
      const before = await this.store.one("OmRequest", { _id: id }, session);
      if (!before) return null;
      const patch = defined(input());
      const after = completeMongoRow("OmRequest", { ...before, ...patch });
      const encoded = encodeMongoRuntimeDocument("OmRequest", after);
      // Update only caller-owned fields plus their HMAC companions. Retries read
      // the latest complete row; unrelated assignment/link metadata is retained.
      const names = [...new Set(Object.keys(patch).flatMap(name => fields[name]?.index ? [name, fields[name].index!] : [name]))];
      check();
      if (names.length) {
        const result = await this.store.collection("OmRequest").updateOne({ _id: id }, { $set: Object.fromEntries(names.map(name => [name, encoded[name]])) }, { session });
        assertMongo(result.matchedCount === 1, "OM_REQUEST_MISSING");
        await this.audit(before, after, session, patch);
      }
      return dto(after);
    });
  }
  updateOmRequest(id: string, input: OmRequestInput) { return this.patch(id, () => inputPatch(input)); }
  setOmRequestOperationId(id: string, operationId: string) { return this.patch(id, () => ({ operationId })); }
  syncAssignedOmByOperationId(operationId: string, assignedOm: string | null) {
    const om = assignedOm?.trim() || null;
    const status = om ? "배정완료" : "배정필요";
    return this.transaction(async (session, check) => {
      const before = await this.store.one("OmRequest", { operationId }, session);
      if (!before) return null;
      const after = completeMongoRow("OmRequest", { ...before, assignedOm: om, status });
      const encoded = encodeMongoRuntimeDocument("OmRequest", after);
      check();
      const result = await this.store.collection("OmRequest").updateOne({ _id: String(before.id) }, { $set: { assignedOm: encoded.assignedOm, assignedOmPiiIndex: encoded.assignedOmPiiIndex, status: encoded.status } }, { session });
      assertMongo(result.matchedCount === 1, "OM_REQUEST_MISSING");
      await this.audit(before, after, session, { assignedOm: om, status });
      return dto(after);
    });
  }
  setOmRequestSlackMeta(id: string, meta: { ldEmail?: string; slackChannel?: string; slackThreadTs?: string }) {
    return this.patch(id, () => ({ ...(meta.ldEmail ? { ldEmail: meta.ldEmail } : {}), ...(meta.slackChannel ? { slackChannel: meta.slackChannel } : {}), ...(meta.slackThreadTs ? { slackThreadTs: meta.slackThreadTs } : {}) }));
  }
  async deleteOmRequest(rawId: string) {
    const id = uuid(rawId);
    return this.transaction(async (session, check) => {
      const before = await this.store.one("OmRequest", { _id: id }, session);
      if (!before) return false;
      check();
      const result = await this.store.collection("OmRequest").deleteOne({ _id: id }, { session });
      assertMongo(result.deletedCount === 1, "OM_REQUEST_MISSING");
      await this.audit(before, null, session); return true;
    });
  }
}
