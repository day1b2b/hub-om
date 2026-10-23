import type { CompanyBusinessInfoRepository } from "./companyBusinessInfoRepository";
import { PrismaCompanyBusinessInfoRepository } from "./prismaCompanyBusinessInfoRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

// companyBusinessInfoComposition이 Mongo shadow 모드일 때만 override를 등록한다
// (instructorNoteRepositoryFactory와 동일한 패턴). 등록이 없으면 Postgres로 읽고 쓴다 —
// 기업위키 화면엔 로컬 JSON 모드가 없으므로(업무요청으로 접수된 기업만 다룸) 분기가 둘뿐이다.
export function getCompanyBusinessInfoRepository(): CompanyBusinessInfoRepository {
  const override = getDataRepositoryOverride("companyBusinessInfo");
  if (override) return override;
  return new PrismaCompanyBusinessInfoRepository();
}
