import { getPrismaClient } from "./prisma";
import type { CompanyBusinessInfoRepository } from "./companyBusinessInfoRepository";
import { touchesBusinessInfo, type CompanyBusinessInfo, type CompanyBusinessInfoPatch } from "./companyBusinessInfoTypes";

/** 빈 문자열/null은 "지웠다"는 뜻으로 null로, undefined는 "건드리지 않음"으로 둔다. */
function normalizeValue(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const SELECT = {
  businessNumber: true,
  representativeName: true,
  address: true,
  businessType: true,
  businessItem: true,
  invoiceEmail: true,
  invoiceEmailSecondary: true,
  memo: true,
  businessInfoUpdatedAt: true,
  businessInfoUpdatedBy: true
} as const;

function toBusinessInfo(row: {
  businessNumber: string | null;
  representativeName: string | null;
  address: string | null;
  businessType: string | null;
  businessItem: string | null;
  invoiceEmail: string | null;
  invoiceEmailSecondary: string | null;
  memo: string | null;
  businessInfoUpdatedAt: Date | null;
  businessInfoUpdatedBy: string | null;
}): CompanyBusinessInfo {
  return {
    businessNumber: row.businessNumber,
    representativeName: row.representativeName,
    address: row.address,
    businessType: row.businessType,
    businessItem: row.businessItem,
    invoiceEmail: row.invoiceEmail,
    invoiceEmailSecondary: row.invoiceEmailSecondary,
    memo: row.memo,
    businessInfoUpdatedAt: row.businessInfoUpdatedAt?.toISOString() ?? null,
    businessInfoUpdatedBy: row.businessInfoUpdatedBy
  };
}

export class PrismaCompanyBusinessInfoRepository implements CompanyBusinessInfoRepository {
  async get(companyId: string): Promise<CompanyBusinessInfo | null> {
    const row = await getPrismaClient().company.findUnique({ where: { id: companyId }, select: SELECT });
    return row ? toBusinessInfo(row) : null;
  }

  async update(companyId: string, patch: CompanyBusinessInfoPatch, updatedBy: string): Promise<CompanyBusinessInfo> {
    const row = await getPrismaClient().company.update({
      where: { id: companyId },
      data: {
        businessNumber: normalizeValue(patch.businessNumber),
        representativeName: normalizeValue(patch.representativeName),
        address: normalizeValue(patch.address),
        businessType: normalizeValue(patch.businessType),
        businessItem: normalizeValue(patch.businessItem),
        invoiceEmail: normalizeValue(patch.invoiceEmail),
        invoiceEmailSecondary: normalizeValue(patch.invoiceEmailSecondary),
        memo: normalizeValue(patch.memo),
        ...(touchesBusinessInfo(patch) ? { businessInfoUpdatedAt: new Date(), businessInfoUpdatedBy: updatedBy } : {})
      },
      select: SELECT
    });
    return toBusinessInfo(row);
  }
}
