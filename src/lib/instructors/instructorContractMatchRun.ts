// 강사 매칭 dry-run 실행 — 세 원천(운영현황·계약시트·노션노트·기존 링크)을 읽어 순수 집계기(buildMatchPreview)에 넘긴다.
// 아무것도 저장하지 않는다(읽기 전용). 실제 연결(링크 쓰기)은 프리뷰 확인 후 별도 단계에서.
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { listInstructorNotes, resolveNotionLinkTargets } from "@/lib/data/instructorWikiStore";
import { readInstructorContractRecords } from "./instructorContractSheet";
import { buildMatchPreview, type MatchPreview } from "./instructorContractMatchPreview";

export type { MatchPreview, MatchPreviewLink } from "./instructorContractMatchPreview";

/** 세 원천을 읽어 매칭 프리뷰(dry-run)를 만든다. 아무것도 저장하지 않는다. */
export async function runInstructorContractMatchPreview(): Promise<MatchPreview> {
  const [operations, contracts, notes] = await Promise.all([
    getOperationRepository().listOperations(),
    readInstructorContractRecords(),
    listInstructorNotes()
  ]);
  const linkTargets = resolveNotionLinkTargets(notes);
  return buildMatchPreview(operations, contracts, notes, linkTargets);
}
