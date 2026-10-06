import { BSON, MongoServerError, type ClientSession } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import type { OmRequest } from "./omRequest/omRequestTypes";
import { OmAssignmentConflict, normalizedInput, previewAssignment, confirmAssignment, type OmAssignmentRepository, type OmAssignmentTransaction, type AssignmentRequest, type AssignmentOperation, type Creation } from "./omRequest/omAssignmentContract";
import { assertMongo, completeMongoRow, MONGO_SCAN_BYTES, MONGO_SCAN_ROWS, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { assertMongoCourseNameRestoreGuardReady, lockMongoCourseNameRestore, prepareMongoCourseNameRestoreGuard } from "./mongoCourseNameRestoreGuard";
import { encodeMongoRuntimeDocument, MongoJsonNull } from "./mongoRuntimeCodec";
import { operationAuditRow } from "./mongoOperationAudit";

export const OM_ASSIGNMENT_MODELS = ["OmRequest", "OperationSession", "ActivityChange"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
class FirstGuardRace extends Error {}
const TIMEOUT_MS = 30_000;
export async function prepareMongoOmAssignmentStore(options: Options): Promise<void> {
  try {
    await prepareMongoReadStore(options, OM_ASSIGNMENT_MODELS);
    await prepareMongoCourseNameRestoreGuard(new MongoOperationStore(options, OM_ASSIGNMENT_MODELS), options.allowShadowWrites);
  } catch { throw new MongoOperationError("OM_ASSIGNMENT_PREPARE_FAILED"); }
}

/** Explicit shadow backend. The existing restore guard also orders assignment/restore
 * predicate dependencies. Business rows are never touched merely to acquire a lock. */
export class MongoOmAssignmentRepository implements OmAssignmentRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options): Promise<MongoOmAssignmentRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, OM_ASSIGNMENT_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCourseNameRestoreGuardReady(store);
      return new MongoOmAssignmentRepository(store);
    } catch { throw new MongoOperationError("OM_ASSIGNMENT_OPEN_FAILED"); }
  }
  private async transaction<T>(confirm: boolean, work: (tx: OmAssignmentTransaction) => Promise<T>): Promise<T> {
    const deadline = performance.now() + TIMEOUT_MS;
    const check = () => assertMongo(performance.now() < deadline, "OM_ASSIGNMENT_TIMEOUT");
    try {
      assertPrivacyConfiguration();
      for (let attempt = 0; attempt < 5; attempt++) {
        check();
        const session = this.store.client.startSession();
        try {
          return await session.withTransaction(async () => {
            check();
            if (confirm) {
              try { await lockMongoCourseNameRestore(this.store, session); }
              catch (error) {
                // Only an initial guard upsert can trigger this outer retry. Never
                // replay arbitrary business duplicates or an uncertain commit.
                if (error instanceof MongoServerError && error.code === 11000) throw new FirstGuardRace();
                throw error;
              }
            }
            check();
            const result = await work(this.port(session, check));
            check(); return result;
          }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: Math.max(1, Math.ceil(deadline - performance.now())) });
        } catch (error) {
          if (error instanceof FirstGuardRace && attempt < 4) continue;
          throw error;
        } finally { await session.endSession(); }
      }
      throw new MongoOperationError("OM_ASSIGNMENT_RETRY_LIMIT");
    } catch (error) {
      if (error instanceof OmAssignmentConflict) throw error;
      // Driver callback/commit retry has already finished. Do not assert rollback
      // on an unknown commit outcome and do not expose codec/driver parameters.
      throw new MongoOperationError("OM_ASSIGNMENT_TRANSACTION_FAILED");
    }
  }
  private port(session: ClientSession, check: () => void): OmAssignmentTransaction {
    const store = this.store;
    const selected = (row: MongoRow): AssignmentOperation => ({ id: row.id, operationId: row.operationId, roundNo: row.roundNo,
      omName: row.omName, omUserId: row.omUserId, operationStatus: row.operationStatus, updatedAt: row.updatedAt, deletedAt: row.deletedAt }) as AssignmentOperation;
    const patch = async (model: "OmRequest" | "OperationSession", id: string, values: MongoRow) => {
      check();
      const before = await store.one(model, { _id: id }, session);
      assertMongo(before, "OM_ASSIGNMENT_ROW_DISAPPEARED");
      const after = completeMongoRow(model, { ...before, ...values, ...(model === "OperationSession" ? { updatedAt: new Date() } : {}) });
      const document = encodeMongoRuntimeDocument(model, after);
      const names = model === "OmRequest" ? ["assignedOm", "assignedOmPiiIndex", "status"]
        : ["omName", "omNamePiiIndex", "omUserId", "omUserIdPiiIndex", "operationStatus", "updatedAt"];
      check();
      const result = await store.collection(model).updateOne({ _id: id }, { $set: Object.fromEntries(names.map(name => [name, document[name]])) }, { session });
      assertMongo(result.matchedCount === 1, "OM_ASSIGNMENT_ROW_DISAPPEARED");
      const audit = operationAuditRow(model, before, after);
      if (audit) await store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    };
    return {
      async getRequest(id) {
        check(); const row = await store.one("OmRequest", { _id: id }, session);
        return row ? { ...row, sessions: row.sessions === MongoJsonNull ? null : row.sessions } as AssignmentRequest : null;
      },
      async getOperation(operationId) { check(); const row = await store.one("OperationSession", { operationId }, session); return row ? selected(row) : null; },
      async getOperations(ids) { check(); return (await store.scan("OperationSession", { _id: { $in: ids } }, session)).map(selected); },
      async listCreations(filter) {
        check();
        const query = { ...filter, ...(typeof filter.targetType === "object" ? { targetType: { $in: filter.targetType.in } } : {}) };
        // Exact creation metadata only: encrypted changes and actor fields never
        // participate in linking or require decryption for this lookup.
        const rows: Creation[] = []; let bytes = 0, lastId: string | undefined;
        const scanDeadline = performance.now() + 15_000;
        while (true) {
          check();
          const remaining = Math.ceil(scanDeadline - performance.now());
          assertMongo(remaining > 0, "OM_ASSIGNMENT_SCAN_TIMEOUT");
          // Match the shared store's single-batch keyset strategy. The driver
          // cannot issue getMore under transaction CSOT with its maxTimeMS.
          const cursor = store.collection("ActivityChange").find(lastId === undefined ? query : { $and: [query, { _id: { $gt: lastId } }] }, {
            session, projection: { _id: 1, requestId: 1, route: 1, method: 1, targetType: 1, targetId: 1, action: 1 },
            singleBatch: true, batchSize: 100, maxTimeMS: remaining, collation: { locale: "simple" }
          }).sort({ _id: 1 }).limit(100);
          let count = 0;
          try {
            for await (const row of cursor) {
              check(); count++; lastId = row._id; bytes += BSON.calculateObjectSize(row);
              assertMongo(rows.length < MONGO_SCAN_ROWS && bytes <= MONGO_SCAN_BYTES, "OM_ASSIGNMENT_SCAN_LIMIT");
              rows.push({ requestId: row.requestId, route: row.route, method: row.method,
                targetType: row.targetType, targetId: row.targetId, action: row.action } as Creation);
            }
          } finally { await cursor.close(); }
          assertMongo(performance.now() <= scanDeadline, "OM_ASSIGNMENT_SCAN_TIMEOUT");
          // A short page may hit the BSON limit; only an empty page proves EOF.
          if (!count) return rows;
        }
      },
      updateOperation: (id, values) => patch("OperationSession", id, values),
      updateRequest: (id, values) => patch("OmRequest", id, values)
    };
  }
  async previewOmAssignment(existing: OmRequest, nextOm: string | null, actorEmail: string) {
    const input = normalizedInput(nextOm, actorEmail);
    return this.transaction(false, tx => previewAssignment(tx, existing, input.nextOm, input.actor));
  }
  async assignOmRequestAtomically(existing: OmRequest, nextOm: string | null, actorEmail: string, token: string) {
    const input = normalizedInput(nextOm, actorEmail);
    return this.transaction(true, tx => confirmAssignment(tx, existing, input.nextOm, input.actor, token));
  }
}
