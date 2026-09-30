// 표준 운영 DTO를 넓히지 않고 Calendar 역반영에 필요한 수정 시각만 읽는다.
import { getCalendarPersistence } from "./calendarPersistence";

export async function findOperationUpdatedAt(operationIds: string[]): Promise<Map<string, Date>> {
  return getCalendarPersistence().findOperationUpdatedAt(operationIds);
}
