import type { OperationRepository } from "./operationRepository";
import { CalendarReflectingOperationRepository } from "./calendarReflectingOperationRepository";
import { LocalJsonOperationRepository } from "./localJsonOperationRepository";
import { PrismaOperationRepository } from "./prismaOperationRepository";

export function getOperationRepository(): OperationRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL) {
    // 로컬 JSON 모드는 개발용이라 구글 캘린더에 쓰지 않는다.
    // 이벤트 매핑 테이블도 DB에만 있어서 반영할 곳이 없다.
    return new LocalJsonOperationRepository();
  }

  return new CalendarReflectingOperationRepository(new PrismaOperationRepository());
}
