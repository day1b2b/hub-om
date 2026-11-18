// 강사 계약폼(구글폼 "강사 계약 요청 폼") 프리필 링크 생성.
// 운영현황 교육상세의 "강사 계약요청" 버튼이 이 URL을 연다 → 값이 채워진 폼이 뜨고, OM이 확인·제출하면
// 폼이 응답시트에 정상 기록한다(hub가 시트에 쓰지 않음 → 쓰기 권한 불필요, 행정팀 프로세스 그대로).
//
// entry ID는 viewform의 FB_PUBLIC_LOAD_DATA_에서 추출한 값이다. 폼 문항이 바뀌면 갱신 필요.
// 2026-11-18: 계약 폼이 새 폼(…dKjCmqkNGr…)으로 교체돼 URL·entry ID·소속 보기 전부 갱신.
import { normalizePersonKey } from "@/lib/data/roleAssignees";
import { splitPersonNames } from "@/lib/data/personNames";

const FORM_PREFILL_BASE =
  "https://docs.google.com/forms/d/e/1FAIpQLSdKjCmqkNGrKP6CXRfPbVddmgfHt1CwZngJWVKdt-6QePs6gA/viewform?usp=pp_url";

// 자동채움하는 칸의 entry ID(2026-11-18 새 폼 기준). department만 라디오("소속 (부서장)") — 값이 보기
// 문자열과 같아야 선택된다. schedule(강의 일정)은 "출강" 페이지 칸이라, 계약유형=출강일 때만 쓰인다.
// 역할·소득구분·계약유형 등 나머지 선택 칸은 수동.
const ENTRY = {
  courseId: "entry.166345351",
  courseName: "entry.1306180943",
  instructorName: "entry.357792703",
  schedule: "entry.913040116",
  manager: "entry.1866948758",
  email: "entry.1836583410",
  department: "entry.1608543103"
} as const;

/**
 * "소속 (부서장)" 라디오 보기 원문(2026-11-18 새 폼 확인) ← 멤버관리 팀(TeamUser.team).
 * AX 컨설팅 3개 파트만 자동 선택한다. 다른 보기(온라인·공공·마케팅)는 쓰지 않는다.
 * ※ 값이 폼 보기 문자열과 글자 하나까지 같아야 선택된다 — 새 폼은 "AX 컨설팅 N파트 (부서장)" 순서.
 */
export const DEPARTMENT_CHOICE_BY_TEAM: Readonly<Record<string, string>> = {
  "AX 1파트": "AX 컨설팅 1파트 (김솔이)",
  "AX 2파트": "AX 컨설팅 2파트 (강지선)",
  "AX 3파트": "AX 컨설팅 3파트 (정다혜)"
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

/**
 * 계약폼 "과정명"에 넣을 값은 코스ID명(courseIdLabel)을 쓴다. 단 "[부가세 별도]" 류 태그만
 * 떼고 나머지(예: "(B2B)")는 그대로 둔다. 코스ID명이 없거나 태그뿐이면 ""를 돌려주고,
 * 호출부는 이 경우 계약폼으로 넘어가지 못하게 막는다(계약서에 빈 과정명 방지).
 */
export function contractCourseNameFromLabel(courseIdLabel: string | undefined): string {
  return (courseIdLabel ?? "").replace(/\[부가세[^\]]*\]\s*/g, "").trim();
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
