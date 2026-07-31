import fs from "fs";
import path from "path";

// 강사위키에서 OM이 입력하는 항목(강사명 수정·파트너ID·특이사항·섭외지양·계약/정산)을
// 강사명 기준으로 로컬 파일에 저장한다. .local/ 은 gitignore → 로컬(dev) 전용, 배포 무영향.
// 배포(DB 모드) 저장은 별도 Prisma 모델/마이그레이션 + 권한·보안 검토가 필요하다.
const DATA_FILE = path.join(process.cwd(), ".local", "instructor-wiki.json");

export interface InstructorNote {
  displayName?: string;  // 강사명 수정값
  partnerId?: string;
  notes?: string;        // 강사 특이사항
  recruitAvoid?: boolean; // 섭외 지양
  contact?: string;      // 연락처
  email?: string;
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

// 부분 필드만 병합 저장(섭외지양 토글, 폼 저장이 각각 일부만 보낼 수 있음).
export function saveInstructorNote(name: string, patch: InstructorNote): InstructorNote {
  const all = readAll();
  const merged = { ...all[name], ...patch };
  all[name] = merged;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf-8");
  return merged;
}
