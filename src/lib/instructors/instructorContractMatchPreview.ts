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
  /** 새로 자동 연결 가능(이미 연결된 것 제외) */
  autoLinkable: number;
  /** 매칭됐지만 이미 수동 연결돼 있음 */
  alreadyLinked: number;
  /** 동명이인 등으로 자동 연결 보류 */
  ambiguous: number;
  sampleAutoLinks: MatchPreviewLink[];
  sampleAmbiguous: { operationName: string; reason: string }[];
}

const SAMPLE_LIMIT = 50;

/**
 * 읽은 원천으로 매칭 프리뷰를 만든다. 순수 함수(I/O 없음).
 * - 운영현황 강사 자유텍스트를 (코스ID, 표기) 토큰으로 쪼갠다.
 * - 계약시트를 다리로 노션 강사에 매칭한다(matchInstructorLinks).
 * - 이미 연결된 표기(linkTargets: 표기→노션강사명)는 "이미 연결"로 분리한다.
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

  let autoLinkable = 0;
  let alreadyLinked = 0;
  const sampleAutoLinks: MatchPreviewLink[] = [];
  for (const link of links) {
    if (linkTargets[link.operationName] !== undefined) {
      alreadyLinked++;
      continue;
    }
    autoLinkable++;
    if (sampleAutoLinks.length < SAMPLE_LIMIT) {
      sampleAutoLinks.push({
        operationName: link.operationName,
        notionName: nameByNo.get(link.notionNo) ?? `NO ${link.notionNo}`,
        via: link.via
      });
    }
  }

  return {
    operationTokens: opInstructors.length,
    contractRecords: contracts.length,
    notionInstructors: notionRefs.length,
    autoLinkable,
    alreadyLinked,
    ambiguous: ambiguous.length,
    sampleAutoLinks,
    sampleAmbiguous: ambiguous.slice(0, SAMPLE_LIMIT).map((item) => ({ operationName: item.operationName, reason: item.reason }))
  };
}
