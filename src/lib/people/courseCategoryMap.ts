import { COURSE_CATEGORY_GROUPS, getCourseCategoryMajor } from "@/lib/data/omRequest/omCourseCategoryOptions";

// =============================================================================
// 교육 분야 공통 기준 = 과정 카테고리(OM 업무요청 대분류 6 · 소분류 18).
// 강사 노션 DB "카테고리"는 이름이 달라서, 과정 대분류로 옮겨 맞춘다(노션 값은 바꾸지 않는다).
// =============================================================================

export const COURSE_CATEGORY_MAJORS = COURSE_CATEGORY_GROUPS.map((group) => group.major);

const NOTION_TO_MAJOR: Record<string, string> = {
  생성형AI: "AI·AX",
  데이터사이언스: "데이터·프로그래밍",
  데이터엔지니어링: "데이터·프로그래밍",
  프로그래밍: "데이터·프로그래밍",
  업무생산성: "디지털 업무·콘텐츠",
  oa: "디지털 업무·콘텐츠",
  크리에이티브: "디지털 업무·콘텐츠",
  퍼블리셔: "디지털 업무·콘텐츠",
  마케팅: "직무·비즈니스",
  PO: "직무·비즈니스",
  UXUI: "직무·비즈니스",
  파이낸스: "직무·비즈니스",
  "회계/세무": "직무·비즈니스",
  "VC투자/심사": "직무·비즈니스",
  "경영/리더십": "조직·리더십",
  소프트스킬: "조직·리더십",
  인사노무: "조직·리더십",
  devops: "IT 인프라·보안",
  클라우드: "IT 인프라·보안",
  금융보안: "IT 인프라·보안"
};

/** 강사 노션 카테고리 → 과정 대분류. 맞는 대분류가 없으면 undefined(예: 의료기기). */
export function notionCategoryToMajor(category: string): string | undefined {
  return NOTION_TO_MAJOR[category.trim()];
}

/** 과정 카테고리 값(소분류)의 대분류. 대분류 이름이 그대로 들어와도 받아 준다. */
export function courseCategoryMajor(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return getCourseCategoryMajor(trimmed) ?? (COURSE_CATEGORY_MAJORS.includes(trimmed) ? trimmed : undefined);
}
