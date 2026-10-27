// 강사 매칭 dry-run 프리뷰 — 순수 로직만. 저장소(factory) import를 넣지 않아 유닛테스트가 I/O 없이 돈다.
// 읽기(운영현황·계약시트·노션노트·기존 링크)는 instructorContractMatchRun이 하고, 여기선 받은 값만 집계한다.
import type { OperationSession } from "@/lib/data/operationTypes";
import type { InstructorNote } from "@/lib/data/instructorNoteRepository";
import { parseInstructorNames } from "@/features/wiki/instructorWikiModel";
import type { InstructorContractRecord } from "./instructorContractSheet";
import { matchInstructorLinks, type NotionInstructorRef, type OperationInstructor } from "./instructorContractMatch";

export interface MatchPreviewLink {
  operationName: string;
  notionName: string;
  via: "email" | "name";
}

export interface MatchPreview {
  operationTokens: number;
  contractRecords: number;
  notionInstructors: number;
  /** 진짜 새 연결 = 운영현황 표기 ≠ 노션 강사명(예: "디노랩스_김진태" → "김진태"). 위키가 못 붙이던 걸 고치는 실제 대상. */
  newLinks: number;
  /** 표기 == 노션 강사명. 이미 위키가 이름으로 붙이는 건이라 새로 할 게 없음. */
  sameNameMatched: number;
  /** 매칭됐지만 이미 수동 연결돼 있음. */
  alreadyLinked: number;
  /** 동명이인 등으로 자동 연결 보류. */
  ambiguous: number;
  /** 진짜 새 연결 샘플(표기 ≠ 노션명만). */
  sampleNewLinks: MatchPreviewLink[];
  sampleAmbiguous: { operationName: string; reason: string }[];
}

const SAMPLE_LIMIT = 50;

/**
 * 읽은 원천으로 매칭 프리뷰를 만든다. 순수 함수(I/O 없음).
 * - 운영현황 강사 자유텍스트를 (코스ID, 표기) 토큰으로 쪼갠다.
 * - 계약시트를 다리로 노션 강사에 매칭한다(matchInstructorLinks).
 * - 매칭된 링크를 세 갈래로 분류한다:
 *   ① 이미 수동 연결됨(linkTargets) ② 표기==노션명(이미 이름매칭, 새로 할 것 없음)
 *   ③ 표기≠노션명 = 진짜 새 연결(위키가 못 붙이던 걸 고침).
 */
export function buildMatchPreview(
  operations: Pick<OperationSession, "courseId" | "instructors">[],
  contracts: InstructorContractRecord[],
  notes: InstructorNote[],
  linkTargets: Record<string, string>
): MatchPreview {
  const notionRefs: NotionInstructorRef[] = notes
    .filter((note) => note.notion && note.notionNo !== undefined)
    .map((note) => ({ notionNo: note.notionNo as number, name: (note.instructorName ?? "").trim(), emails: [] }));
  const nameByNo = new Map(notionRefs.map((ref) => [ref.notionNo, ref.name]));

  const seen = new Set<string>();
  const opInstructors: OperationInstructor[] = [];
  for (const op of operations) {
    const courseId = (op.courseId ?? "").trim();
    if (!courseId) continue;
    for (const name of parseInstructorNames(op.instructors)) {
      const key = `${courseId}\u0000${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      opInstructors.push({ courseId, name });
    }
  }

  const { links, ambiguous } = matchInstructorLinks(opInstructors, contracts, notionRefs);

  let newLinks = 0;
  let sameNameMatched = 0;
  let alreadyLinked = 0;
  const sampleNewLinks: MatchPreviewLink[] = [];
  for (const link of links) {
    if (linkTargets[link.operationName] !== undefined) {
      alreadyLinked++;
      continue;
    }
    const notionName = nameByNo.get(link.notionNo) ?? "";
    // 표기가 노션명과 같으면 위키가 이미 이름으로 붙이는 건 → 새로 할 게 없다.
    if (link.operationName === notionName) {
      sameNameMatched++;
      continue;
    }
    newLinks++;
    if (sampleNewLinks.length < SAMPLE_LIMIT) {
      sampleNewLinks.push({ operationName: link.operationName, notionName, via: link.via });
    }
  }

  return {
    operationTokens: opInstructors.length,
    contractRecords: contracts.length,
    notionInstructors: notionRefs.length,
    newLinks,
    sameNameMatched,
    alreadyLinked,
    ambiguous: ambiguous.length,
    sampleNewLinks,
    sampleAmbiguous: ambiguous.slice(0, SAMPLE_LIMIT).map((item) => ({ operationName: item.operationName, reason: item.reason }))
  };
}
