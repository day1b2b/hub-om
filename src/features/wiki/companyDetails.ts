// 기업 위키 상세(예시 데이터). 삼성전기를 레퍼런스 구조로 삼아, 기업명 기반 해시로
// 기업마다 값이 결정적으로 달라지게 생성한다. 연락처는 모두 마스킹, 실데이터 아님.

export interface WikiCourse {
  id: string;
  name: string;
  syncup: boolean;
  lms: boolean;
  drive: boolean;
  report: boolean;
}

export interface WikiContact {
  name: string;
  role: string;
  email: string;
  phone: string;
  comm: string;
  work: string;
}

export interface CompanyDetail {
  om: string;
  year: string;
  settlement: string;
  courses: WikiCourse[];
  contacts: WikiContact[];
  settlementProcess: string[];
  evidence: string;
  customForm: string;
  background: string[];
  preferredStyle: string[];
  retention: string[];
  instructorPref: string[];
  venues: string[];
}

const OM_POOL = ["김정선", "조여경", "이현정", "안유진", "이혜림", "최지현", "박현서", "윤정아"];
const YEAR_POOL = ["2025", "2026"];
const SETTLEMENT_POOL = ["계산서 발행", "월별 정산", "선입금 후 정산", "과정 종료 후 일괄 정산"];
const COURSE_POOL = [
  "AI 트렌드 특강",
  "생성형 AI 실무 과정",
  "데이터 리터러시 입문",
  "프롬프트 엔지니어링",
  "AI 업무자동화 과정",
  "리더 대상 AX 과정",
  "AI 중급 활용 과정",
  "신입 온보딩 AI 특강"
];
const CONTACT_NAME_POOL = ["김◯수", "이◯민", "박◯영", "최◯선", "정◯아", "한◯우", "오◯진", "장◯희"];
const CONTACT_REGION_POOL = ["수원", "서울", "부산", "세종", "판교", "대전"];
const ROLE_POOL = ["프로(파트장)", "프로", "책임", "선임"];
const COMM_POOL = [
  "OM의 밀착 관리 선호",
  "핵심만 간결히 보고 선호",
  "데이터 근거 기반 소통 중시",
  "자율적 진행 선호",
  "정기 미팅으로 진행 확인 선호"
];
const WORK_POOL = [
  "처음~끝까지 전 과정 공유 선호",
  "마일스톤 중심 보고 선호",
  "이슈 발생 시 즉시 공유 선호",
  "월 단위 요약 보고 선호"
];
const BACKGROUND_POOL = [
  "사내에서 AX를 강하게 드라이브 중",
  "AI 활용 사례 공모전 운영",
  "직무별 AI 교육으로 확대 니즈 강함",
  "전사 디지털 전환 과제와 연계",
  "경영진 관심도가 높은 핵심 과제"
];
const PREFERRED_POOL = [
  "실습 비율 높은 구성 선호",
  "업무 실사례 공유 니즈 강함",
  "짧은 세션 여러 차수 선호",
  "사전 진단 후 맞춤 커리큘럼 선호"
];
const RETENTION_POOL = [
  "LD/OM 밀착 관리",
  "현장 조기 도착으로 세심하게 챙김",
  "아이디어·의견 적극 제안",
  "차수별 피드백 신속 반영"
];
const INSTRUCTOR_POOL = [
  "딜리버리 능력 좋은 강사 선호",
  "실무 경험 풍부한 강사 선호",
  "플립러닝 병행 가능한 강사 선호",
  "고객사 도메인 이해도 높은 강사 선호"
];
const VENUE_SUFFIX_POOL = ["본사 강의장", "연수원", "지역 사업장 강의장", "외부 대여 강의장"];

function hash(value: string): number {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) sum += value.charCodeAt(index) * (index + 1);
  return Math.abs(sum);
}

function pick<T>(pool: T[], seed: number): T {
  return pool[seed % pool.length];
}

function pickMany<T>(pool: T[], count: number, seed: number): T[] {
  const result: T[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = pool[(seed + i * 3) % pool.length];
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function maskedEmail(seed: number): string {
  const heads = ["ha", "yo", "mi", "ju", "so", "da"];
  const tails = ["kim", "lee", "park", "choi", "jung", "han"];
  return `${pick(heads, seed)}***${(seed % 90) + 10}.${pick(tails, seed >> 1)}@day1company.co.kr`;
}

function maskedPhone(seed: number): string {
  const last = String((seed * 37) % 10000).padStart(4, "0");
  return `010-****-${last}`;
}

// 삼성전기 = 레퍼런스(전달받은 예시 그대로).
const SAMSUNG_EM: CompanyDetail = {
  om: "이혜림",
  year: "2026",
  settlement: "계산서 발행",
  courses: [
    { id: "261060", name: "AI 트렌드 특강", syncup: true, lms: true, drive: true, report: true },
    { id: "261613", name: "AI 중급 활용 오프라인 과정", syncup: true, lms: true, drive: true, report: false }
  ],
  contacts: [
    { name: "이◯민(수원)", role: "프로(파트장)", email: "ha***4u.lee@day1company.co.kr", phone: "010-****-1714", comm: "OM의 밀착 관리 좋아함 (1:1과외 수준)", work: "처음~끝까지 모든 내용 공유 선호" },
    { name: "이◯영(부산)", role: "프로(파트장)", email: "ho***18.lee@day1company.co.kr", phone: "010-****-8750", comm: "-", work: "-" },
    { name: "김◯선(세종)", role: "프로", email: "yo***96.kim@day1company.co.kr", phone: "010-****-5892", comm: "-", work: "-" }
  ],
  settlementProcess: [
    "1. 계산서 발행 (내용 확인 요청 → 발행 요청 구글폼 작성)",
    "2. 상생협력법 약정서 날인 (확인 후 인감 날인 결재 상신 → 사업지원실 날인 요청)",
    "* 방문 날인 운영 시간: 오전 10:00~11:00 / 오후 13:30~15:00"
  ],
  evidence: "전달 완료 (사업자 등록증, 통장 사본)",
  customForm: "없음 (필요 시 고객사에서 요청)",
  background: [
    "사내에서 AX를 강하게 드라이브 중, AI 공모전 진행",
    "AI 특강 확대 니즈 강함 → 사업 확장성 큼"
  ],
  preferredStyle: ["실습 비율 80% 이상 구성 추구", "업무 실사례 공유 니즈 강함"],
  retention: ["밀착 관리 (LD/OM 둘 다)", "아이디어·의견 제안 선호", "현장 조기 도착으로 세심히 챙김"],
  instructorPref: ["딜리버리 능력 좋은 분 선호", "플립러닝 시 온라인 강사의 오프라인 실습 병행 선호"],
  venues: ["삼성전기 수원 강의장", "삼성전기 세종 강의장", "삼성전기 부산 강의장"]
};

const REFERENCE: Record<string, CompanyDetail> = {
  삼성전기: SAMSUNG_EM
};

// 기업명 기반으로 결정적으로 상세를 생성(예시 데이터).
function generateDetail(companyName: string): CompanyDetail {
  const seed = hash(companyName);
  const shortName = companyName.split("_")[0].replace(/\([^)]*\)/g, "").trim() || companyName;
  const courseCount = (seed % 2) + 1; // 1~2
  const contactCount = (seed % 3) + 1; // 1~3

  const courses: WikiCourse[] = Array.from({ length: courseCount }, (_, i) => ({
    id: `${(seed % 9000) + 261000 + i}`,
    name: pick(COURSE_POOL, seed + i * 2),
    syncup: (seed + i) % 4 !== 0,
    lms: (seed + i) % 3 !== 0,
    drive: (seed + i) % 5 !== 0,
    report: (seed + i) % 2 === 0
  }));

  const contacts: WikiContact[] = Array.from({ length: contactCount }, (_, i) => {
    const s = seed + i * 5;
    const region = pick(CONTACT_REGION_POOL, s);
    return {
      name: `${pick(CONTACT_NAME_POOL, s)}(${region})`,
      role: pick(ROLE_POOL, s),
      email: maskedEmail(s),
      phone: maskedPhone(s),
      comm: i === 0 ? pick(COMM_POOL, s) : "-",
      work: i === 0 ? pick(WORK_POOL, s) : "-"
    };
  });

  return {
    om: pick(OM_POOL, seed),
    year: pick(YEAR_POOL, seed),
    settlement: pick(SETTLEMENT_POOL, seed),
    courses,
    contacts,
    settlementProcess: [
      `1. ${pick(SETTLEMENT_POOL, seed)} (내용 확인 → 발행/정산 요청)`,
      "2. 계약/약정서 확인 후 날인 결재 상신",
      "* 세부 절차는 고객사 담당자와 확인 (예시)"
    ],
    evidence: "전달 완료 (사업자 등록증, 통장 사본) — 예시",
    customForm: (seed % 2) === 0 ? "없음 (필요 시 고객사 요청)" : "고객사 고유 정산 양식 사용",
    background: pickMany(BACKGROUND_POOL, 2, seed),
    preferredStyle: pickMany(PREFERRED_POOL, 2, seed + 1),
    retention: pickMany(RETENTION_POOL, 3, seed + 2),
    instructorPref: pickMany(INSTRUCTOR_POOL, 2, seed + 3),
    venues: [`${shortName} ${pick(VENUE_SUFFIX_POOL, seed)}`, `${shortName} ${pick(VENUE_SUFFIX_POOL, seed + 2)}`]
  };
}

export function getCompanyDetail(companyName: string): CompanyDetail {
  return REFERENCE[companyName] ?? generateDetail(companyName);
}
