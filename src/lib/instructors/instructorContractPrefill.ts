// 강사 계약폼(구글폼 "B2B_NEW 강사 계약서 설문지 [2408~]") 프리필 링크 생성.
// 운영현황 교육상세의 "강사 계약요청" 버튼이 이 URL을 연다 → 값이 채워진 폼이 뜨고, OM이 확인·제출하면
// 폼이 응답시트에 정상 기록한다(hub가 시트에 쓰지 않음 → 쓰기 권한 불필요, 행정팀 프로세스 그대로).
//
// entry ID는 viewform의 FB_PUBLIC_LOAD_DATA_에서 추출한 값이다(2026-10-27). 폼 문항이 바뀌면 갱신 필요.
import { normalizePersonKey } from "@/lib/data/roleAssignees";
import { splitPersonNames } from "@/lib/data/personNames";

const FORM_PREFILL_BASE =
  "https://docs.google.com/forms/d/e/1FAIpQLSf7IQkqglf-Z0uP90WoHLSJoEBP-lnYmQ3HeielXh0c5qSF_Q/viewform?usp=pp_url";

// 자동채움하는 칸의 entry ID. department만 라디오("소속 및 부서장") — 값이 보기 문자열과 같아야 선택된다.
// 계약유형 등 나머지 선택 칸은 수동.
const ENTRY = {
  courseId: "entry.1145840833",
  courseName: "entry.207260427",
  instructorName: "entry.767785093",
  schedule: "entry.1208608124",
  manager: "entry.349088038",
  email: "entry.842558702",
  department: "entry.195171543"
} as const;

/**
 * "소속 및 부서장" 라디오 보기 원문(2026-11-04 폼 확인) ← 멤버관리 팀(TeamUser.team).
 * AX 컨설팅 3개 파트만 자동 선택한다. 다른 보기(온라인·공공·마케팅)는 쓰지 않는다.
 */
export const DEPARTMENT_CHOICE_BY_TEAM: Readonly<Record<string, string>> = {
  "AX 1파트": "김솔이 (AX 컨설팅 1파트)",
  "AX 2파트": "강지선 (AX 컨설팅 2파트)",
  "AX 3파트": "정다혜 (AX 컨설팅 3파트)"
};

/**
 * 담당 OM(여러 명이면 쉼표 등으로 구분)의 팀으로 "소속 및 부서장" 보기를 고른다.
 * 담당 OM을 멤버관리에서 못 찾거나, 팀이 AX 3개 파트가 아니거나, 담당자들의 파트가 갈리면 ""(폼에서 직접 선택).
 */
export function resolveDepartmentChoice(manager: string, teamByPersonKey: Readonly<Record<string, string>>): string {
  const names = splitPersonNames(manager, "");
  if (names.length === 0 || (names.length === 1 && !names[0])) return "";
  const choices = new Set(names.map((name) => DEPARTMENT_CHOICE_BY_TEAM[teamByPersonKey[normalizePersonKey(name)] ?? ""] ?? ""));
  const [choice] = choices;
  return choices.size === 1 && choice ? choice : "";
}

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
  /** "소속 및 부서장" 보기(resolveDepartmentChoice). 비면 생략 → 폼에서 선택. */
  department?: string;
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
  add(ENTRY.department, values.department);
  const query = params.toString();
  return query ? `${FORM_PREFILL_BASE}&${query}` : FORM_PREFILL_BASE;
}
