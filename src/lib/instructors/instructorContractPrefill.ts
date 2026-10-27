// 강사 계약폼(구글폼 "B2B_NEW 강사 계약서 설문지 [2408~]") 프리필 링크 생성.
// 운영현황 교육상세의 "강사 계약요청" 버튼이 이 URL을 연다 → 값이 채워진 폼이 뜨고, OM이 확인·제출하면
// 폼이 응답시트에 정상 기록한다(hub가 시트에 쓰지 않음 → 쓰기 권한 불필요, 행정팀 프로세스 그대로).
//
// entry ID는 viewform의 FB_PUBLIC_LOAD_DATA_에서 추출한 값이다(2026-10-27). 폼 문항이 바뀌면 갱신 필요.
const FORM_PREFILL_BASE =
  "https://docs.google.com/forms/d/e/1FAIpQLSf7IQkqglf-Z0uP90WoHLSJoEBP-lnYmQ3HeielXh0c5qSF_Q/viewform?usp=pp_url";

// 자동채움하는 칸의 entry ID(전부 텍스트 칸이라 프리필 안전). 드롭다운(계약유형·소속부서장 등)은 수동.
const ENTRY = {
  courseId: "entry.1145840833",
  courseName: "entry.207260427",
  instructorName: "entry.767785093",
  schedule: "entry.1208608124",
  manager: "entry.349088038",
  email: "entry.842558702"
} as const;

export interface ContractPrefillValues {
  courseId: string;
  courseName: string;
  instructorName: string;
  /** 강의 일정 문자열(예: "2026.08.25 (화) 09:00~17:00"). 여러 회차는 줄바꿈으로 이어붙인다. */
  schedule: string;
  /** 담당 OM 이름 */
  manager: string;
  /** 강사 이메일(노션에서 live로 읽어 넣음). 못 읽으면 생략 → 폼에서 수동 입력. */
  email?: string;
}

/** 값이 채워진 계약폼 프리필 URL을 만든다. 빈 값은 넣지 않는다(폼에서 수동 입력으로 남음). */
export function buildContractPrefillUrl(values: ContractPrefillValues): string {
  const params = new URLSearchParams();
  const add = (entry: string, value: string | undefined) => {
    const trimmed = (value ?? "").trim();
    if (trimmed) params.append(entry, trimmed);
  };
  add(ENTRY.courseId, values.courseId);
  add(ENTRY.courseName, values.courseName);
  add(ENTRY.instructorName, values.instructorName);
  add(ENTRY.schedule, values.schedule);
  add(ENTRY.manager, values.manager);
  add(ENTRY.email, values.email);
  const query = params.toString();
  return query ? `${FORM_PREFILL_BASE}&${query}` : FORM_PREFILL_BASE;
}
