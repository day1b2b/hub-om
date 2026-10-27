// 운영현황 강사 자유텍스트 → 노션 강사(NO) 자동 연결.
//
// 문제: 운영현황의 강사명은 자유 텍스트("디노랩스_김진태")라 노션 강사("김진태")와 자동으로 안 붙는다.
// 해결: 강사 계약 시트를 다리로 쓴다. 계약 시트엔 "강의 코스 ID"가 있어 운영현황과 숫자 키로 붙고,
//       그 행의 강사 이메일(거의 유일키)/강사명으로 노션 강사에 연결한다.
//   운영현황(코스ID) → 계약시트(코스ID → 강사명·이메일) → 노션 강사(이메일 우선, 없으면 이름)
//
// 순수 함수다. 시트·노션 읽기(I/O)는 호출부가 하고, 여기선 이미 읽은 배열만 받아 매칭한다.
// 결과는 "운영현황 표기 → 노션 NO" 연결값뿐이다. 이메일 등 PII는 결과에 담지 않는다.
// 모호하면(동명이인 등) 연결하지 않고 ambiguous로 남긴다 — 틀린 합침보다 수동 연결이 안전(이인우 사례).
import type { InstructorContractRecord } from "./instructorContractSheet";

export interface NotionInstructorRef {
  notionNo: number;
  name: string;
  /** 노션 강사 DB의 이메일 칸들(여러 개 가능). 매칭 순간에만 쓰고 저장하지 않는다. */
  emails: string[];
}

/** 운영현황에서 뽑은 (코스ID, 강사 표기) 한 건. 강사 표기는 호출부가 토큰 단위로 쪼갠 값. */
export interface OperationInstructor {
  courseId: string;
  name: string;
}

export interface ResolvedLink {
  /** 운영현황의 원래 표기(그대로 연결 키로 쓴다) */
  operationName: string;
  notionNo: number;
  /** 연결 근거: 이메일(강) / 이름(중) */
  via: "email" | "name";
}

export interface AmbiguousLink {
  operationName: string;
  courseId: string;
  reason: string;
}

export interface MatchResult {
  links: ResolvedLink[];
  ambiguous: AmbiguousLink[];
}

/** 소속 접두사("디노랩스_김진태" → "김진태")를 떼고 공백 제거·소문자화해 비교용 이름을 만든다. */
export function normalizeInstructorName(raw: string): string {
  let name = (raw ?? "").trim();
  const underscore = name.lastIndexOf("_");
  if (underscore >= 0) name = name.slice(underscore + 1);
  return name.replace(/\s+/g, "").toLowerCase();
}

function normalizeEmail(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * 운영현황 강사 표기들을 계약 시트를 다리로 노션 강사에 연결한다.
 * - 코스ID로 그 교육의 계약 레코드를 찾고, 이름이 같은 레코드만 후보로 쓴다.
 * - 후보의 이메일이 노션 강사 이메일과 맞으면 연결(via=email). 없으면 노션에 동명이 유일할 때만 이름으로 연결(via=name).
 * - 계약 근거가 없으면(코스 매칭 실패) 조용히 건너뛴다. 노션에 동명이인이면 ambiguous로 남긴다.
 */
export function matchInstructorLinks(
  operations: OperationInstructor[],
  contracts: InstructorContractRecord[],
  notion: NotionInstructorRef[]
): MatchResult {
  const notionByEmail = new Map<string, number>();
  const notionByName = new Map<string, number[]>();
  for (const ref of notion) {
    const normName = normalizeInstructorName(ref.name);
    if (normName) {
      const list = notionByName.get(normName) ?? [];
      list.push(ref.notionNo);
      notionByName.set(normName, list);
    }
    for (const email of ref.emails) {
      const normEmail = normalizeEmail(email);
      if (normEmail) notionByEmail.set(normEmail, ref.notionNo);
    }
  }

  const contractsByCourse = new Map<string, InstructorContractRecord[]>();
  for (const record of contracts) {
    if (!record.courseId) continue;
    const list = contractsByCourse.get(record.courseId) ?? [];
    list.push(record);
    contractsByCourse.set(record.courseId, list);
  }

  const links: ResolvedLink[] = [];
  const ambiguous: AmbiguousLink[] = [];
  const handled = new Set<string>();

  for (const op of operations) {
    if (handled.has(op.name)) continue;
    const opNorm = normalizeInstructorName(op.name);
    if (!opNorm) continue;

    const courseContracts = contractsByCourse.get(op.courseId) ?? [];
    const nameMatches = courseContracts.filter((record) => normalizeInstructorName(record.instructorName) === opNorm);
    if (nameMatches.length === 0) continue; // 그 코스에 이 강사 계약 근거 없음 → 수동 연결로 남김

    // 1순위: 이메일로 노션 연결(거의 유일키)
    let resolved: ResolvedLink | null = null;
    for (const record of nameMatches) {
      const normEmail = normalizeEmail(record.email);
      const notionNo = normEmail ? notionByEmail.get(normEmail) : undefined;
      if (notionNo !== undefined) {
        resolved = { operationName: op.name, notionNo, via: "email" };
        break;
      }
    }

    // 2순위: 이름으로(노션에 동명이 유일할 때만)
    if (!resolved) {
      const candidates = notionByName.get(opNorm) ?? [];
      if (candidates.length === 1) {
        resolved = { operationName: op.name, notionNo: candidates[0], via: "name" };
      } else if (candidates.length > 1) {
        ambiguous.push({ operationName: op.name, courseId: op.courseId, reason: `노션에 동명 ${candidates.length}명 — 수동 확인 필요` });
        handled.add(op.name);
        continue;
      }
    }

    if (resolved) {
      links.push(resolved);
      handled.add(op.name);
    }
  }

  return { links, ambiguous };
}
