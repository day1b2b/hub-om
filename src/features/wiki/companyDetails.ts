// 기업 위키 상세(예시 데이터). 노션 기업위키 템플릿(HL만도 등) 구조를 따른다.
// 삼성전기를 레퍼런스로 삼고, 나머지는 기업명 해시로 결정적으로 생성한다. 연락처는 마스킹, 실데이터 아님.

export interface WikiCourse {
  id: string;
  name: string;
  syncup: boolean;
  lms: boolean;
  drive: boolean;
  report: boolean;
  instructor: string; // 담당자(강사)
}

export interface WikiContact {
  name: string;
  role: string;
  email: string;
  phone: string;
  comm: string;
  work: string;
}

export interface WikiCourseHistory {
  label: string;
  period: string;
  satisfaction: string;
  feedback: string;
}

export interface WikiFacility {
  location: string;       // 교육장 위치
  accessSecurity: string; // 출입/보안 절차
  meal: string;           // 식사/다과
  network: string;        // 네트워크/보안
  equipment: string;      // 필수 장비/젠더
  audio: string;          // 음향/포인터
}

export interface WikiDocument {
  name: string;        // 사업자등록증, 통장사본 등
  registered: boolean; // 등록 여부
}

export interface CompanyDetail {
  om: string;
  year: string;
  courses: WikiCourse[];
  contacts: WikiContact[];
  courseHistory: WikiCourseHistory[];
  // 담당자 운영 디테일
  preferredStyle: string;     // 선호하는 교육 방식
  retention: string;          // 리텐션 필살기
  instructorFeedback: string; // 강사 피드백
  managerInsight: string;     // 운영 매니저의 제언(Insight)
  // 현장/인프라 정보
  facility: WikiFacility;
  // 행정/정산
  settlementProcess: string;  // 정산 프로세스
  evidence: string;           // 증빙 서류 패키지
  documents: WikiDocument[];  // 등록 문서(사업자등록증·통장사본 등)
}

const OM_POOL = ["김정선", "조여경", "이현정", "안유진", "이혜림", "최지현", "박현서", "윤정아"];
const YEAR_POOL = ["2025", "2026"];
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
const INSTRUCTOR_NAME_POOL = ["김강사(기초)", "이강사(실무)", "박강사", "정강사(기초)", "최강사(실무)", "한강사"];
const PREFERRED_STYLE_POOL = [
  "교육생 실제 업무 자료로 실습·산출물 도출하는 과제형 진행",
  "짧은 세션 여러 차수로 분할 진행 선호",
  "사전 진단 후 맞춤 커리큘럼 구성 선호",
  "이론보다 실습 비중 높은 구성 추구"
];
const RETENTION_POOL = [
  "실무 활용 실습·산출물 + LD/OM 밀착 관리",
  "차수별 피드백 신속 반영",
  "현장 조기 도착으로 세심하게 챙김",
  "아이디어·의견 적극 제안"
];
const INSTRUCTOR_FEEDBACK_POOL = [
  "개인별 실습 모니터링·피드백 원활한 강사 선호",
  "딜리버리 좋은 강사 호평, 연락 지연 이력 강사 주의",
  "도메인 이해도 높은 강사 만족도 높음",
  "실무 경험 풍부한 강사 재요청 의사"
];
const MANAGER_INSIGHT_POOL = [
  "난이도 있는 과정 → 교육생 모니터링 원활한 강사 섭외가 핵심",
  "만족도에 민감 → 사후 피드백 신속 대응 필요",
  "결정 라인이 길어 승인에 여유 필요",
  "차수 변경이 잦아 일정 재확인 필수"
];
const VENUE_SUFFIX_POOL = ["본사 강의장", "연수원 강의장", "지역 사업장 강의장", "외부 대여 강의장"];
const ACCESS_SECURITY_POOL = [
  "방문 2일 전 보안 신청 + 서약서, 강의장 촬영 금지",
  "게스트 등록 후 QR 출입",
  "별도 보안 절차 없음",
  "반입 장비 사전 신청 필요"
];
const MEAL_POOL = ["중식·다과 고객사 제공", "다과만 제공", "별도 제공 없음 (인근 식당 이용)"];
const NETWORK_POOL = [
  "사내 게스트 Wi-Fi (당일 발급), 실습용 사내 GPT 계정 사전 신청",
  "교육장 Wi-Fi 사용",
  "VPN 불필요 (오픈 환경)",
  "폐쇄망 — 실습 계정 고객사 사전 발급"
];
const EQUIPMENT_POOL = ["젠더·HDMI 보유", "젠더 지참 권장", "빔·스크린 완비", "노트북 고객사 대여 가능"];
const AUDIO_POOL = ["마이크·포인터 사용 가능", "핀마이크 보유", "포인터 지참 권장"];
const SETTLEMENT_PROCESS_POOL = [
  "실제 수행 교육 건별 청구로 진행",
  "과정 종료 후 일괄 계산서 발행",
  "월별 정산",
  "선입금 후 정산"
];
const EVIDENCE_POOL = [
  "사업자 등록증, 통장 사본",
  "강사 프로필, 대학졸업증명서, 재직증명서, 주민등록 사본",
  "계약서·약정서 사본, 사업자 등록증"
];
const HISTORY_FEEDBACK_POOL = [
  "실습 비중 만족",
  "난이도 다소 높음 의견",
  "강사 전달력 호평",
  "진행 매끄러움 평가",
  "시간 부족 의견 일부"
];
const PERIOD_POOL = ["2025-06", "2025-09", "2025-11", "2026-02", "2026-04"];
const COURSE_ROUND_POOL = ["1차", "2차", "3차"];

function hash(value: string): number {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) sum += value.charCodeAt(index) * (index + 1);
  return Math.abs(sum);
}

function pick<T>(pool: T[], seed: number): T {
  return pool[seed % pool.length];
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

// 삼성전기 = 레퍼런스(전달받은 예시 톤 반영).
const SAMSUNG_EM: CompanyDetail = {
  om: "이혜림",
  year: "2026",
  courses: [
    { id: "261060", name: "AI 트렌드 특강", syncup: true, lms: true, drive: true, report: true, instructor: "김강사(기초)" },
    { id: "261613", name: "AI 중급 활용 오프라인 과정", syncup: true, lms: true, drive: true, report: false, instructor: "이강사(실무)" }
  ],
  contacts: [
    { name: "이◯민(수원)", role: "프로(파트장)", email: "ha***4u.lee@day1company.co.kr", phone: "010-****-1714", comm: "OM의 밀착 관리 좋아함 (1:1과외 수준)", work: "처음~끝까지 모든 내용 공유 선호" },
    { name: "이◯영(부산)", role: "프로(파트장)", email: "ho***18.lee@day1company.co.kr", phone: "010-****-8750", comm: "-", work: "-" },
    { name: "김◯선(세종)", role: "프로", email: "yo***96.kim@day1company.co.kr", phone: "010-****-5892", comm: "-", work: "-" }
  ],
  courseHistory: [
    { label: "AI 트렌드 특강 3차", period: "2025-11", satisfaction: "4.6 / 5.0", feedback: "실습 비중·사례 호평, 시간 부족 의견 일부" },
    { label: "AI 중급 활용 오프라인 2차", period: "2025-09", satisfaction: "4.4 / 5.0", feedback: "난이도 적절, 딜리버리 만족도 높음" },
    { label: "AI 트렌드 특강 2차", period: "2025-06", satisfaction: "4.7 / 5.0", feedback: "현장 실습 만족, 재요청 의사" }
  ],
  preferredStyle: "실습 비율 80% 이상, 업무 실사례 기반 구성 추구",
  retention: "실무 활용 실습·산출물 + LD/OM 밀착 관리",
  instructorFeedback: "개인별 실습 모니터링·피드백 원활한 강사 선호, 딜리버리 능력 중시",
  managerInsight: "난이도 있는 과정 → 교육생 모니터링 원활한 강사 섭외가 핵심. 만족도에 민감해 사후 피드백 신속 대응 필요",
  facility: {
    location: "삼성전기 수원 사업장 강의장 (세종·부산 병행)",
    accessSecurity: "방문 2일 전 보안 신청 + 서약서, 반입 노트북 사전 등록, 강의장 촬영 금지",
    meal: "중식·다과 고객사 제공",
    network: "사내 게스트 Wi-Fi (당일 발급), 실습용 사내 GPT 계정 사전 신청",
    equipment: "젠더·HDMI 보유",
    audio: "마이크·포인터 사용 가능"
  },
  settlementProcess: "계산서 발행(내용 확인 → 발행 요청 구글폼) 후 상생협력법 약정서 날인 결재",
  evidence: "사업자 등록증, 통장 사본 (강사 프로필·재직/졸업 증명 요청 시)",
  documents: [
    { name: "사업자등록증", registered: true },
    { name: "통장사본", registered: true }
  ]
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
    report: (seed + i) % 2 === 0,
    instructor: pick(INSTRUCTOR_NAME_POOL, seed + i)
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

  const historyCount = (seed % 2) + 2; // 2~3
  const courseHistory: WikiCourseHistory[] = Array.from({ length: historyCount }, (_, i) => {
    const s = seed + i * 7;
    const score = (40 + (s % 10)) / 10; // 4.0 ~ 4.9
    return {
      label: `${pick(COURSE_POOL, s)} ${pick(COURSE_ROUND_POOL, s)}`,
      period: pick(PERIOD_POOL, s),
      satisfaction: `${score.toFixed(1)} / 5.0`,
      feedback: pick(HISTORY_FEEDBACK_POOL, s)
    };
  });

  return {
    om: pick(OM_POOL, seed),
    year: pick(YEAR_POOL, seed),
    courses,
    contacts,
    courseHistory,
    preferredStyle: pick(PREFERRED_STYLE_POOL, seed),
    retention: pick(RETENTION_POOL, seed + 1),
    instructorFeedback: pick(INSTRUCTOR_FEEDBACK_POOL, seed + 2),
    managerInsight: pick(MANAGER_INSIGHT_POOL, seed + 3),
    facility: {
      location: `${shortName} ${pick(VENUE_SUFFIX_POOL, seed)}`,
      accessSecurity: pick(ACCESS_SECURITY_POOL, seed),
      meal: pick(MEAL_POOL, seed + 1),
      network: pick(NETWORK_POOL, seed + 2),
      equipment: pick(EQUIPMENT_POOL, seed + 3),
      audio: pick(AUDIO_POOL, seed + 4)
    },
    settlementProcess: pick(SETTLEMENT_PROCESS_POOL, seed),
    evidence: pick(EVIDENCE_POOL, seed + 1),
    documents: [
      { name: "사업자등록증", registered: seed % 2 === 0 },
      { name: "통장사본", registered: seed % 3 !== 0 }
    ]
  };
}

export function getCompanyDetail(companyName: string): CompanyDetail {
  return REFERENCE[companyName] ?? generateDetail(companyName);
}
