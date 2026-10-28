// 운영현황 교육(회차들) → 강사별 "계약요청" 대상 생성 + 상태추적. 순수 함수(I/O 없음).
// - 과정의 여러 회차(courseOperations)에서 강사를 모아, 같은 강사는 1건으로 묶는다(설계: 1교육×1강사).
// - 일정은 그 강사가 든 회차들의 교육일을 합쳐 만든다.
// - 상태(requested)는 계약 응답시트 레코드에 (코스ID × 강사명)이 있는지로 판단한다(미요청/요청됨).
// - 이메일은 계약 응답시트(Q열)에서 강사명으로 조회해 붙인다. hub DB는 강사 이메일을 저장하지 않고
//   (instructorNotePii) 노션 런타임 SDK도 없어, 시트가 요청시점에 유일하게 읽을 수 있는 소스다.
//   과거 계약이 있던 강사는 여기서 이메일이 채워지고, 없으면 빈칸 → 폼에서 수동 입력한다.
import type { OperationSession } from "@/lib/data/operationTypes";
import { normalizeCourseId } from "@/lib/data/operationCalculations";
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

/**
 * (정규화 코스ID × 정규화 강사명) 상태 조회 키.
 * 코스ID는 normalizeCourseId로 맞춘다 — 시트 J열에 '238061.0'·제로폭 문자 같은 드리프트가 있어
 * raw 비교하면 "요청됨"을 놓친다(operations/매출연동도 같은 정규화를 쓴다).
 */
function statusKey(courseId: string, normName: string): string {
  return `${normalizeCourseId(courseId)}\u0000${normName}`;
}

interface ContractRecordIndex {
  /** (코스ID × 정규화 강사명) 집합 = 응답시트에 레코드가 있음(= 요청됨). */
  requestedKeys: Set<string>;
  /** (코스ID × 정규화 강사명) → 이메일. 그 코스 레코드가 직접 가진 이메일(가장 확실). */
  emailByStatusKey: Map<string, string>;
  /** 정규화 강사명 → 그 강사의 서로 다른 비지 않은 이메일 집합(동명이인 모호 판별용). */
  emailsByInstructor: Map<string, Set<string>>;
}

/** 응답시트 레코드를 요청집합 + 이메일 색인으로 만든다(요청 생성·상태 조회가 공유). */
function indexContractRecords(records: InstructorContractRecord[]): ContractRecordIndex {
  const requestedKeys = new Set<string>();
  const emailByStatusKey = new Map<string, string>();
  const emailsByInstructor = new Map<string, Set<string>>();
  for (const record of records) {
    const courseId = (record.courseId ?? "").trim();
    const norm = normalizeInstructorName(record.instructorName);
    if (!norm) continue;
    if (courseId) requestedKeys.add(statusKey(courseId, norm));
    const email = (record.email ?? "").trim();
    if (email) {
      if (courseId) emailByStatusKey.set(statusKey(courseId, norm), email);
      const set = emailsByInstructor.get(norm) ?? new Set<string>();
      set.add(email);
      emailsByInstructor.set(norm, set);
    }
  }
  return { requestedKeys, emailByStatusKey, emailsByInstructor };
}

/**
 * 강사 이메일을 고른다: ① 이 코스ID의 레코드가 가진 이메일(가장 확실) → ② 없으면 다른 코스의
 * 이메일이 '유일할 때만' 사용(동명이인 대비). 서로 다른 이메일이 2개 이상이면 모호로 보고 비운다
 * (틀린 이메일 프리필보다 폼 수동입력이 안전 — instructorContractMatch의 ambiguous 원칙과 같다).
 */
function resolveEmail(index: ContractRecordIndex, courseId: string, normName: string): string | undefined {
  if (!normName) return undefined;
  const courseEmail = index.emailByStatusKey.get(statusKey(courseId, normName));
  if (courseEmail) return courseEmail;
  const all = index.emailsByInstructor.get(normName);
  return all && all.size === 1 ? [...all][0] : undefined;
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

type CourseOperation = Pick<
  OperationSession,
  "instructors" | "courseId" | "courseName" | "om" | "educationDates" | "startDate" | "endDate" | "timeText"
>;

/**
 * 과정의 회차들 + 계약 응답시트 레코드로 강사별 계약요청 대상을 만든다.
 * 같은 강사의 여러 회차는 1건으로 묶고(일정 합침), 응답시트에 이미 있으면 requested=true.
 */
export function buildInstructorContractRequests(
  courseOperations: CourseOperation[],
  contractRecords: InstructorContractRecord[]
): ContractRequestItem[] {
  const index = indexContractRecords(contractRecords);

  // 강사별로 그 강사가 든 회차를 모은다. 키는 '원본 표기(trim)'다 — 정규화 이름으로 묶으면
  // normalizeInstructorName이 소속 접두사를 떼어 '디노랩스_김진태'와 '패스트캠퍼스_김진태'(서로 다른
  // 사람)를 한 건으로 합쳐 한 명이 목록에서 사라진다. 상태·이메일 매칭만 정규화 이름으로 한다.
  const byInstructor = new Map<string, { name: string; sessions: CourseOperation[] }>();
  for (const op of courseOperations) {
    for (const rawName of parseInstructorNames(op.instructors)) {
      const key = rawName.trim();
      if (!key) continue;
      const entry = byInstructor.get(key) ?? { name: key, sessions: [] };
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
      requested: index.requestedKeys.has(statusKey(courseId, normName)),
      email: resolveEmail(index, courseId, normName)
    });
  }

  return items.sort((a, b) => a.instructorName.localeCompare(b.instructorName, "ko"));
}

export interface ContractStatusPair {
  courseId: string;
  instructorName: string;
}

export interface ContractStatusResult {
  courseId: string;
  instructorName: string;
  /** 이 코스ID로 이미 요청됨(응답시트에 레코드 있음). */
  requested: boolean;
  /** 응답시트에서 찾은 강사 이메일. 없으면 생략. */
  email?: string;
}

/**
 * (코스ID × 강사명) 쌍마다 계약 응답시트 기준 상태를 돌려준다(교육상세 보강용).
 * 운영현황 표기(소속 접두사 등)는 정규화해 매칭하되, 결과의 courseId·instructorName은 받은 값을 그대로 돌려준다.
 * 요청한 쌍만 돌려주므로 시트 전체 이메일이 노출되지 않는다.
 */
export function resolveInstructorContractStatus(
  records: InstructorContractRecord[],
  pairs: ContractStatusPair[]
): ContractStatusResult[] {
  const index = indexContractRecords(records);
  return pairs.map((pair) => {
    const courseId = (pair.courseId ?? "").trim();
    const normName = normalizeInstructorName(pair.instructorName);
    return {
      courseId: pair.courseId,
      instructorName: pair.instructorName,
      requested: normName ? index.requestedKeys.has(statusKey(courseId, normName)) : false,
      email: resolveEmail(index, courseId, normName)
    };
  });
}
