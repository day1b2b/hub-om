// 타입/순수 함수만 둔다 — 클라이언트 컴포넌트(CompanyWiki.tsx 등)가 여기서 import해야
// Prisma/pg 같은 서버 전용 코드가 브라우저 번들에 섞여 들어가지 않는다.
// 실제 DB 접근은 companyBusinessInfoRepository.ts(서버 전용)에서만 한다.

/** 기업위키에서 OM/LD가 직접 입력·수정하는 사업자등록증 정보. 운영 현황에서 파생되지 않는다. */
export interface CompanyBusinessInfo {
  businessNumber: string | null;
  representativeName: string | null;
  address: string | null;
  businessType: string | null;
  businessItem: string | null;
  invoiceEmail: string | null;
  invoiceEmailSecondary: string | null;
  businessInfoUpdatedAt: string | null;
  businessInfoUpdatedBy: string | null;
}

export type CompanyBusinessInfoPatch = Partial<
  Pick<
    CompanyBusinessInfo,
    "businessNumber" | "representativeName" | "address" | "businessType" | "businessItem" | "invoiceEmail" | "invoiceEmailSecondary"
  >
>;

export function emptyCompanyBusinessInfo(): CompanyBusinessInfo {
  return {
    businessNumber: null,
    representativeName: null,
    address: null,
    businessType: null,
    businessItem: null,
    invoiceEmail: null,
    invoiceEmailSecondary: null,
    businessInfoUpdatedAt: null,
    businessInfoUpdatedBy: null
  };
}
