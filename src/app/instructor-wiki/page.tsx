import { InstructorWiki } from "@/features/wiki/InstructorWiki";
import {
  aggregateInstructors,
  attachCoachSummaries,
  mergeNotionInstructors,
  type InstructorWikiEntry,
  type InstructorWikiProvenance
} from "@/features/wiki/instructorWikiModel";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { getAllInstructorNotes } from "@/lib/data/instructorWikiStore";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function InstructorWikiPage() {
  await requireAdminSession();

  let entries: InstructorWikiEntry[] = [];
  let loadFailed = false;

  // 담당 코스·과정은 운영 현황에서 온다.
  try {
    const operations = await getOperationRepository().listOperations();
    entries = aggregateInstructors(operations);
  } catch {
    loadFailed = true;
  }

  const operationEntryCount = entries.length;

  // 강사 명단·프로필은 노션 강사 DB에서 온다. 운영 배정이 없는 강사도 목록에 세운다.
  const notes = await getAllInstructorNotes();
  const notionNames = Object.keys(notes).filter((name) => notes[name]?.notion);
  entries = mergeNotionInstructors(entries, notionNames);

  // coach-db 연결 시 전문분야/평가 보강(best-effort). 미연결이면 조용히 건너뛴다.
  try {
    const coaches = await getCoachRepository().listCoaches();
    if (coaches.length > 0) {
      attachCoachSummaries(entries, coaches);
    }
  } catch {
    // coach-db 미연결(로컬 dev 등) → 보강 생략
  }

  // 노션 명단이 목록의 기준이 되면 provenance도 노션이다. 노션 동기화 전에는 운영 현황만 남는다.
  const provenance: InstructorWikiProvenance =
    entries.length === 0 ? "empty" : notionNames.length > 0 ? "notion" : "operations";

  // 섭외지양 표기 대상. 노션 강사 DB의 "섭외지양 여부"만 본다(수동 토글 없음).
  const recruitAvoidNames = Object.keys(notes).filter((name) => notes[name]?.notion?.recruitAvoid);

  return (
    <InstructorWiki
      entries={entries}
      loadFailed={loadFailed}
      operationEntryCount={operationEntryCount}
      provenance={provenance}
      recruitAvoidNames={recruitAvoidNames}
    />
  );
}
