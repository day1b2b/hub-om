// 운영현황 교육(회차들) → 강사별 "계약요청" 대상 생성 + 상태추적. 순수 함수(I/O 없음).
// - 과정의 여러 회차(courseOperations)에서 강사를 모아, 같은 강사는 1건으로 묶는다(설계: 1교육×1강사).
// - 일정은 그 강사가 든 회차들의 교육일을 합쳐 만든다.
// - 상태(requested)는 계약 응답시트 레코드에 (코스ID × 강사명)이 있는지로 판단한다(미요청/요청됨).
// - 이메일은 계약 응답시트(Q열)에서 강사명으로 조회해 붙인다. hub DB는 강사 이메일을 저장하지 않고
//   (instructorNotePii) 노션 런타임 SDK도 없어, 시트가 요청시점에 유일하게 읽을 수 있는 소스다.
//   과거 계약이 있던 강사는 여기서 이메일이 채워지고, 없으면 빈칸 → 폼에서 수동 입력한다.
import type { OperationSession } from "@/lib/data/operationTypes";
import { parseInstructorNames } from "@/features/wiki/instructorWikiModel";
import type { InstructorContractRecord } from "./instructorContractSheet";
import { normalizeInstructorName } from "./instructorContractMatch";

export interface ContractRequestItem {
  instructorName: string;
  courseId: string;
  courseName: string;
  /** 프리필에 넣을 일정 문자열(회차 교육일 + 시간대). */
  schedule: string;
  /** 담당 OM. */
  manager: string;
  /** 계약 응답시트에 이미 (코스ID×강사)가 있으면 true = "요청됨". */
  requested: boolean;
  /** 계약 응답시트(Q열)에서 강사명으로 찾은 이메일. 없으면 생략(폼에서 수동 입력). */
  email?: string;
}

/** 교육일 목록(yyyy-mm-dd)과 시간 텍스트를 프리필용 일정 문자열로 만든다. */
export function formatSchedule(dates: string[], timeText: string): string {
  const days = dates
    .filter(Boolean)
    .map((date) => date.replace(/-/g, "."))
    .join(", ");
  const time = (timeText ?? "").trim();
  return [days, time].filter(Boolean).join(" · ");
}

/**
 * 과정의 회차들 + 계약 응답시트 레코드로 강사별 계약요청 대상을 만든다.
 * 같은 강사의 여러 회차는 1건으로 묶고(일정 합침), 응답시트에 이미 있으면 requested=true.
 */
type CourseOperation = Pick<
  OperationSession,
  "instructors" | "courseId" | "courseName" | "om" | "educationDates" | "startDate" | "endDate" | "timeText"
>;

export function buildInstructorContractRequests(
  courseOperations: CourseOperation[],
  contractRecords: InstructorContractRecord[]
): ContractRequestItem[] {
  // 응답시트: (코스ID × 정규화 강사명) 집합 = 이미 요청된 것 + 강사명→이메일 색인.
  // 이메일은 같은 강사의 레코드가 여러 개면 뒤쪽(시트에서 더 아래=더 최근)의 비지 않은 값을 쓴다.
  const requestedKeys = new Set<string>();
  const emailByInstructor = new Map<string, string>();
  for (const record of contractRecords) {
    const courseId = (record.courseId ?? "").trim();
    const norm = normalizeInstructorName(record.instructorName);
    if (!norm) continue;
    if (courseId) requestedKeys.add(`${courseId}\u0000${norm}`);
    const email = (record.email ?? "").trim();
    if (email) emailByInstructor.set(norm, email);
  }

  // 강사별로 그 강사가 든 회차를 모은다(정규화 이름을 키로, 표시는 원래 이름).
  const byInstructor = new Map<string, { name: string; sessions: CourseOperation[] }>();
  for (const op of courseOperations) {
    for (const rawName of parseInstructorNames(op.instructors)) {
      const key = normalizeInstructorName(rawName);
      if (!key) continue;
      const entry = byInstructor.get(key) ?? { name: rawName, sessions: [] };
      entry.sessions.push(op);
      byInstructor.set(key, entry);
    }
  }

  const items: ContractRequestItem[] = [];
  for (const { name, sessions } of byInstructor.values()) {
    const primary = sessions[0];
    const courseId = (primary.courseId ?? "").trim();
    const normName = normalizeInstructorName(name);
    // 이 강사가 든 회차들의 교육일 합치기(없으면 시작~종료일로 대체).
    const dates = Array.from(
      new Set(
        sessions.flatMap((session) =>
          session.educationDates && session.educationDates.length > 0
            ? session.educationDates
            : [session.startDate, session.endDate].filter(Boolean)
        )
      )
    ).sort();
    items.push({
      instructorName: name,
      courseId,
      courseName: primary.courseName,
      schedule: formatSchedule(dates, primary.timeText),
      manager: primary.om,
      requested: requestedKeys.has(`${courseId}\u0000${normName}`),
      email: emailByInstructor.get(normName)
    });
  }

  return items.sort((a, b) => a.instructorName.localeCompare(b.instructorName, "ko"));
}
