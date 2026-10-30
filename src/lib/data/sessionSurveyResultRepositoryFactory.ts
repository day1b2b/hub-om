import type { SessionSurveyResultRepository } from "./sessionSurveyResultRepository";
import { PrismaSessionSurveyResultRepository } from "./prismaSessionSurveyResultRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

// Mongo shadow 런타임(만족도 반영·강사 위키)이 범위 안에 저장소를 등록하면 그것을 쓰고,
// 등록이 없으면 Postgres로 읽고 쓴다(companyBusinessInfoRepositoryFactory와 같은 패턴).
export function getSessionSurveyResultRepository(): SessionSurveyResultRepository {
  const override = getDataRepositoryOverride("sessionSurveyResults");
  if (override) return override;
  return new PrismaSessionSurveyResultRepository();
}
