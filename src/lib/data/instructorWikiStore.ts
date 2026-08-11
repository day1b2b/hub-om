import fs from "fs";
import path from "path";

// 강사위키에서 OM이 입력하는 항목(강사명 수정·파트너ID·특이사항·섭외지양·계약/정산)을
// 강사명 기준으로 로컬 파일에 저장한다. .local/ 은 gitignore → 로컬(dev) 전용, 배포 무영향.
// 배포(DB 모드) 저장은 별도 Prisma 모델/마이그레이션 + 권한·보안 검토가 필요하다.
const DATA_FILE = path.join(process.cwd(), ".local", "instructor-wiki.json");

// 노션 강사 DB에서 긁어온 스냅샷. 자동 채움 값이라 OM이 직접 입력한 값과 섞지 않고 따로 둔다.
// (섞으면 다음 번 가져오기 때 OM이 고친 내용이 덮인다.) 화면에서는 OM 입력값이 우선.
// 계좌·사업자등록증·신분증은 가져오지 않는다. 생년월일만 계약 날인용으로 포함.
export interface InstructorNotionProfile {
  syncedAt?: string;      // 가져온 시각(ISO) — 화면에 "언제 기준 값인지" 표시용
  contact?: string;       // 연락처
  contact2?: string;      // 연락처2
  email?: string;
  email2?: string;
  affiliation?: string;   // 소속정보
  categories?: string[];  // 카테고리 → 전문분야
  lectureTopics?: string[]; // 담당 강의 정보
  baseFee?: number;       // 기본 강사료
  feeNote?: string;       // 강사료 특이사항
  memo?: string;          // 메모
  recruitAvoid?: boolean; // 섭외지양 여부
  birthDate?: string;     // 생년월일
  demoCheckUrl?: string;  // 시범강의 점검표
}

export interface InstructorNote {
  displayName?: string;  // 강사명 수정값
  notionId?: string;     // 노션 강사 페이지 고유 ID(또는 전체 URL) — 연결값
  partnerId?: string;
  notes?: string;        // 강사 특이사항
  recruitAvoid?: boolean; // 섭외 지양
  contact?: string;      // 연락처
  email?: string;
  notion?: InstructorNotionProfile; // 노션 자동 채움값(읽기 전용)
}

function readAll(): Record<string, InstructorNote> {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, InstructorNote>;
  } catch {
    return {};
  }
}

export function getInstructorNote(name: string): InstructorNote {
  return readAll()[name] ?? {};
}

// 목록 화면용: 전체 저장값(섭외지양 표시 등에 사용).
export function getAllInstructorNotes(): Record<string, InstructorNote> {
  return readAll();
}

// 노션 고유 ID(또는 전체 URL) → 열 수 있는 노션 URL. 전체 URL이면 그대로, 아니면 id로 구성.
export function notionHref(idOrUrl: string | undefined): string | null {
  const value = (idOrUrl ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const id = value.replace(/-/g, "");
  return `https://www.notion.so/${id}`;
}

// 부분 필드만 병합 저장(섭외지양 토글, 폼 저장이 각각 일부만 보낼 수 있음).
export function saveInstructorNote(name: string, patch: InstructorNote): InstructorNote {
  const all = readAll();
  const merged = { ...all[name], ...patch };
  all[name] = merged;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf-8");
  return merged;
}
