import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import type { TeamMemberImportEntry, TeamMemberImportRepository } from "./teamMemberImportRepository";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { assertMongoTeamMemberImportGuardReady, lockMongoTeamMemberImport, prepareMongoTeamMemberImportGuard } from "./mongoTeamMemberImportGuard";

export const TEAM_MEMBER_IMPORT_MODELS = ["Member"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
const key = (entry: Pick<TeamMemberImportEntry, "role" | "sourceTeam" | "normalizedName">) => JSON.stringify([entry.role, entry.sourceTeam, entry.normalizedName]);
const groupKey = (role: unknown, sourceTeam: unknown) => JSON.stringify([role, sourceTeam]);

export async function prepareMongoTeamMemberImportStore(options: Options) {
  const store = new MongoOperationStore(options, TEAM_MEMBER_IMPORT_MODELS); await prepareMongoReadStore(options, TEAM_MEMBER_IMPORT_MODELS); await prepareMongoTeamMemberImportGuard(store, options.allowShadowWrites);
}
export class MongoTeamMemberImportRepository implements TeamMemberImportRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE"); const store = new MongoOperationStore(options, TEAM_MEMBER_IMPORT_MODELS);
      const hello = await store.db.command({ hello: 1 }); assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store); await assertMongoTeamMemberImportGuardReady(store); return new MongoTeamMemberImportRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("TEAM_MEMBER_IMPORT_OPEN_FAILED"); }
  }
  private async execute(entries: readonly TeamMemberImportEntry[], apply: boolean, session: ClientSession) {
    const current = await this.store.scan("Member", {}, session), byKey = new Map<string, MongoRow[]>();
    for (const row of current) {
      const entry = { role: row.role, sourceTeam: row.sourceTeam, normalizedName: row.normalizedName } as TeamMemberImportEntry;
      const value = key(entry), rows = byKey.get(value) ?? []; rows.push(row); byKey.set(value, rows);
    }
    let inserted = 0, updated = 0, deactivated = 0;
    for (const entry of entries) {
      const value = key(entry), previous = byKey.get(value) ?? [], now = new Date(); if (previous.length) updated++; else inserted++;
      if (previous.length) {
        const nextRows: MongoRow[] = [];
        for (const row of previous) { const next = completeMongoRow("Member", { ...row, ...entry, isActive: true, updatedAt: now }); nextRows.push(next);
          if (apply) { const result = await this.store.collection("Member").replaceOne({ _id: row.id as string }, encodeMongoRuntimeDocument("Member", next), { session }); assertMongo(result.matchedCount === 1, "ROW_DISAPPEARED"); } }
        byKey.set(value, nextRows);
      } else {
        const next = completeMongoRow("Member", { id: randomUUID(), ...entry, isActive: true, createdAt: now, updatedAt: now });
        if (apply) await this.store.collection("Member").insertOne(encodeMongoRuntimeDocument("Member", next), { session });
        byKey.set(value, [next]);
      }
    }
    const groups = new Map<string, Set<string>>();
    for (const entry of entries) { const value = groupKey(entry.role, entry.sourceTeam), names = groups.get(value) ?? new Set<string>(); names.add(entry.normalizedName); groups.set(value, names); }
    for (const row of current) {
      const names = groups.get(groupKey(row.role, row.sourceTeam));
      if (!names || names.has(row.normalizedName as string) || row.isActive !== true) continue;
      deactivated++;
      if (apply) { const next = completeMongoRow("Member", { ...row, isActive: false, updatedAt: new Date() }); const result = await this.store.collection("Member").replaceOne({ _id: row.id as string }, encodeMongoRuntimeDocument("Member", next), { session }); assertMongo(result.matchedCount === 1, "ROW_DISAPPEARED"); }
    }
    return { total: entries.length, inserted, updated, deactivated };
  }
  async importMembers(entries: readonly TeamMemberImportEntry[], apply: boolean) {
    for (let attempt = 0; attempt < 5; attempt++) { const session = this.store.client.startSession(); try {
      return await session.withTransaction(async () => { if (apply) await lockMongoTeamMemberImport(this.store, session); return this.execute(entries, apply, session); },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
    } catch (error) {
      if (apply && error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
      if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("TEAM_MEMBER_IMPORT_FAILED");
    } finally { await session.endSession(); } }
    throw new MongoOperationError("TEAM_MEMBER_IMPORT_CONCURRENT_CHANGE");
  }
}
