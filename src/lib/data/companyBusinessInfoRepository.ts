import { getPrismaClient } from "./prisma";
import { type CompanyBusinessInfo, type CompanyBusinessInfoPatch } from "./companyBusinessInfoTypes";

export type { CompanyBusinessInfo, CompanyBusinessInfoPatch };
export { emptyCompanyBusinessInfo } from "./companyBusinessInfoTypes";

/** 빈 문자열/null은 "지웠다"는 뜻으로 null로, undefined는 "건드리지 않음"으로 둔다. */
function normalizeValue(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 기업위키 목록 화면에서 회사별 사업자등록증 정보를 한 번에 읽어오기 위한 prefetch. */
export async function listCompanyBusinessInfoById(): Promise<Map<string, CompanyBusinessInfo>> {
  const prisma = getPrismaClient();
  const rows = await prisma.company.findMany({
    select: {
      id: true,
      businessNumber: true,
      representativeName: true,
      address: true,
      businessType: true,
      businessItem: true,
      invoiceEmail: true,
      invoiceEmailSecondary: true,
      businessInfoUpdatedAt: true,
      businessInfoUpdatedBy: true
    }
  });

  return new Map(
    rows.map((row) => [
      row.id,
      {
        businessNumber: row.businessNumber,
        representativeName: row.representativeName,
        address: row.address,
        businessType: row.businessType,
        businessItem: row.businessItem,
        invoiceEmail: row.invoiceEmail,
        invoiceEmailSecondary: row.invoiceEmailSecondary,
        businessInfoUpdatedAt: row.businessInfoUpdatedAt?.toISOString() ?? null,
        businessInfoUpdatedBy: row.businessInfoUpdatedBy
      }
    ])
  );
}

export async function updateCompanyBusinessInfo(
  companyId: string,
  patch: CompanyBusinessInfoPatch,
  updatedBy: string
): Promise<CompanyBusinessInfo> {
  const prisma = getPrismaClient();
  const row = await prisma.company.update({
    where: { id: companyId },
    data: {
      businessNumber: normalizeValue(patch.businessNumber),
      representativeName: normalizeValue(patch.representativeName),
      address: normalizeValue(patch.address),
      businessType: normalizeValue(patch.businessType),
      businessItem: normalizeValue(patch.businessItem),
      invoiceEmail: normalizeValue(patch.invoiceEmail),
      invoiceEmailSecondary: normalizeValue(patch.invoiceEmailSecondary),
      businessInfoUpdatedAt: new Date(),
      businessInfoUpdatedBy: updatedBy
    },
    select: {
      businessNumber: true,
      representativeName: true,
      address: true,
      businessType: true,
      businessItem: true,
      invoiceEmail: true,
      invoiceEmailSecondary: true,
      businessInfoUpdatedAt: true,
      businessInfoUpdatedBy: true
    }
  });

  return {
    businessNumber: row.businessNumber,
    representativeName: row.representativeName,
    address: row.address,
    businessType: row.businessType,
    businessItem: row.businessItem,
    invoiceEmail: row.invoiceEmail,
    invoiceEmailSecondary: row.invoiceEmailSecondary,
    businessInfoUpdatedAt: row.businessInfoUpdatedAt?.toISOString() ?? null,
    businessInfoUpdatedBy: row.businessInfoUpdatedBy
  };
}
