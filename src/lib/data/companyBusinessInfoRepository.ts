// 기업위키 사업자등록증 정보 저장소 계약.
// 배포는 PostgreSQL(기본) 또는 Mongo shadow(운영 전환 중)를 쓰지만, API 라우트는 이
// 인터페이스만 본다 — 백엔드 선택은 companyBusinessInfoComposition/Factory가 맡는다.

import { type CompanyBusinessInfo, type CompanyBusinessInfoPatch } from "./companyBusinessInfoTypes";

export type { CompanyBusinessInfo, CompanyBusinessInfoPatch };
export { emptyCompanyBusinessInfo } from "./companyBusinessInfoTypes";

export interface CompanyBusinessInfoRepository {
  /** 기업 하나의 사업자등록증 정보. 없는 companyId면 null. */
  get(companyId: string): Promise<CompanyBusinessInfo | null>;
  /** 보낸 필드만 병합 저장한다(undefined는 건드리지 않음, 빈 문자열/null은 지움). */
  update(companyId: string, patch: CompanyBusinessInfoPatch, updatedBy: string): Promise<CompanyBusinessInfo>;
}
