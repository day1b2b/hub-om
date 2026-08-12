export interface CourseCategoryGroup {
  major: string;
  minors: string[];
}

export const COURSE_CATEGORY_GROUPS: CourseCategoryGroup[] = [
  { major: "AI·AX", minors: ["AI 리터러시·트렌드", "생성형 AI 업무 활용", "AI 에이전트·업무자동화", "AI 코딩·바이브코딩", "머신러닝·딥러닝"] },
  { major: "데이터·프로그래밍", minors: ["데이터 분석·시각화", "데이터베이스·SQL", "Python·프로그래밍"] },
  { major: "디지털 업무·콘텐츠", minors: ["OA·문서 생산성", "콘텐츠·디자인", "플랫폼·콘텐츠 운영"] },
  { major: "직무·비즈니스", minors: ["마케팅·영업", "서비스기획·UX", "재무·비즈니스", "연구·R&D"] },
  { major: "조직·리더십", minors: ["리더십·변화관리"] },
  { major: "IT 인프라·보안", minors: ["클라우드·개발환경", "정보보안·컴플라이언스"] }
];

export function getCourseCategoryMajor(minor: string): string | undefined {
  return COURSE_CATEGORY_GROUPS.find((group) => group.minors.includes(minor))?.major;
}

export function getCourseCategoryMinors(major: string): string[] {
  return COURSE_CATEGORY_GROUPS.find((group) => group.major === major)?.minors ?? [];
}
