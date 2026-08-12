import type { OmRequest } from "../omRequest/omRequestTypes";
import type { OperationSession } from "../operationTypes";
import { expandDateRange } from "./recommendOms";

// 리소스 페이지 OM 캘린더가 보여주는 것과 같은 두 원천(실제 운영 건 + 배정 완료된 om-request)을 합쳐
// OM별로 이미 강의관리 일정이 잡혀있는 날짜를 계산한다.
export function buildOmBusyDates(
  operations: OperationSession[],
  omRequests: OmRequest[],
  excludeRequestId?: string
): Map<string, Set<string>> {
  const busyDatesByOm = new Map<string, Set<string>>();

  function addDates(om: string | undefined, dates: string[]) {
    if (!om) return;
    const existing = busyDatesByOm.get(om) ?? new Set<string>();
    dates.forEach((date) => existing.add(date));
    busyDatesByOm.set(om, existing);
  }

  operations.forEach((operation) => {
    if (!operation.startDate) return;
    addDates(operation.om, expandDateRange(operation.startDate, operation.endDate));
  });

  omRequests
    .filter((request) => request.assignedOm && request.id !== excludeRequestId)
    .forEach((request) => {
      request.sessions.forEach((session) => {
        addDates(request.assignedOm, expandDateRange(session.date, session.dateEnd));
      });
    });

  return busyDatesByOm;
}
