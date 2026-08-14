import { LocalJsonOmRequestRepository } from "./localJsonOmRequestRepository";
import { PrismaOmRequestRepository } from "./prismaOmRequestRepository";
import type { OmRequestRepository } from "./omRequestRepository";

// 운영 데이터와 같은 기준으로 분기한다(operationRepositoryFactory와 동일).
// 로컬 dev는 파일, 배포는 DB.
export function getOmRequestRepository(): OmRequestRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL) {
    return new LocalJsonOmRequestRepository();
  }

  return new PrismaOmRequestRepository();
}
