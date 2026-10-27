import type { ClientSession } from "mongodb";
import type { CompanyBusinessInfoRepository } from "./companyBusinessInfoRepository";
import type { CompanyBusinessInfo, CompanyBusinessInfoPatch } from "./companyBusinessInfoTypes";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

// Company 컬렉션 자체는 overview-pages/operation Mongo 런타임이 이미 준비해 둔다(같은
// 물리 네임스페이스를 공유) — 이 저장소는 그 컬렉션을 열어 사업자등록증 정보만 읽고 쓴다.
export const COMPANY_BUSINESS_INFO_MODELS = ["Company", "ActivityChange"] as const;
export type MongoCompanyBusinessInfoOptions = MongoOperationOptions & { allowShadowWrites: true };

/** 빈 문자열/null은 "지웠다"는 뜻으로 null로, undefined는 "건드리지 않음"으로 둔다. */
function normalizeValue(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toBusinessInfo(row: MongoRow): CompanyBusinessInfo {
  const updatedAt = row.businessInfoUpdatedAt;
  return {
    businessNumber: (row.businessNumber as string | null) ?? null,
    representativeName: (row.representativeName as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    businessType: (row.businessType as string | null) ?? null,
    businessItem: (row.businessItem as string | null) ?? null,
    invoiceEmail: (row.invoiceEmail as string | null) ?? null,
    invoiceEmailSecondary: (row.invoiceEmailSecondary as string | null) ?? null,
    businessInfoUpdatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : null,
    businessInfoUpdatedBy: (row.businessInfoUpdatedBy as string | null) ?? null
  };
}

export class MongoCompanyBusinessInfoRepository implements CompanyBusinessInfoRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoCompanyBusinessInfoOptions): Promise<MongoCompanyBusinessInfoRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, COMPANY_BUSINESS_INFO_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoCompanyBusinessInfoRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COMPANY_BUSINESS_INFO_OPEN_FAILED");
    }
  }

  async get(companyId: string): Promise<CompanyBusinessInfo | null> {
    assertMongo(typeof companyId === "string" && companyId.length > 0, "COMPANY_BUSINESS_INFO_INVALID_ID");
    const row = await this.store.one("Company", { _id: companyId });
    return row ? toBusinessInfo(row) : null;
  }

  async update(companyId: string, patch: CompanyBusinessInfoPatch, updatedBy: string): Promise<CompanyBusinessInfo> {
    assertMongo(typeof companyId === "string" && companyId.length > 0, "COMPANY_BUSINESS_INFO_INVALID_ID");
    assertMongo(typeof updatedBy === "string" && updatedBy.length > 0, "COMPANY_BUSINESS_INFO_INVALID_ACTOR");
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(
        () => this.applyUpdate(companyId, patch, updatedBy, session),
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 }
      );
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COMPANY_BUSINESS_INFO_TRANSACTION_FAILED");
    } finally {
      await session.endSession();
    }
  }

  private async applyUpdate(companyId: string, patch: CompanyBusinessInfoPatch, updatedBy: string, session: ClientSession): Promise<CompanyBusinessInfo> {
    const previous = await this.store.one("Company", { _id: companyId }, session);
    assertMongo(previous, "COMPANY_NOT_FOUND");
    const next = completeMongoRow("Company", {
      ...previous,
      ...(patch.businessNumber !== undefined ? { businessNumber: normalizeValue(patch.businessNumber) } : {}),
      ...(patch.representativeName !== undefined ? { representativeName: normalizeValue(patch.representativeName) } : {}),
      ...(patch.address !== undefined ? { address: normalizeValue(patch.address) } : {}),
      ...(patch.businessType !== undefined ? { businessType: normalizeValue(patch.businessType) } : {}),
      ...(patch.businessItem !== undefined ? { businessItem: normalizeValue(patch.businessItem) } : {}),
      ...(patch.invoiceEmail !== undefined ? { invoiceEmail: normalizeValue(patch.invoiceEmail) } : {}),
      ...(patch.invoiceEmailSecondary !== undefined ? { invoiceEmailSecondary: normalizeValue(patch.invoiceEmailSecondary) } : {}),
      businessInfoUpdatedAt: new Date(),
      businessInfoUpdatedBy: updatedBy
    });
    const document = encodeMongoRuntimeDocument("Company", next);
    const result = await this.store.collection("Company").replaceOne({ _id: companyId }, document, { session });
    assertMongo(result.matchedCount === 1, "COMPANY_DISAPPEARED");
    const audit = operationAuditRow("Company", previous, next);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    return toBusinessInfo(next);
  }
}
