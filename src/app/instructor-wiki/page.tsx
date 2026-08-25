import { InstructorWiki } from "@/features/wiki/InstructorWiki";
import {
  aggregateInstructors,
  applyNotionLinks,
  attachCoachSummaries,
  mergeNotionNotes,
  type InstructorWikiEntry,
  type InstructorWikiProvenance
} from "@/features/wiki/instructorWikiModel";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { listInstructorNotes, resolveNotionLinkTargets } from "@/lib/data/instructorWikiStore";
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

  const notes = await listInstructorNotes();
  const linkTargets = resolveNotionLinkTargets(notes);

  // OM이 연결해 둔 노션 강사로 먼저 합친다. 운영 현황 표기가 달라 갈려 있던 같은 사람을 하나로.
  entries = applyNotionLinks(entries, linkTargets);

  const operationEntryCount = entries.length;

  // 강사 명단·프로필은 노션 강사 DB에서 온다(연결 키 = 노션 NO). 운영 배정이 없는 강사도 세운다.
  // 연결된 표기(linkTargets의 키)는 위에서 합쳐 없앴으므로 다시 세우지 않는다.
  const notionNotes = notes.filter(
    (note) => note.notion && note.notionNo !== undefined && !linkTargets[(note.instructorName ?? "").trim()]
  );
  entries = mergeNotionNotes(entries, notionNotes);

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
    entries.length === 0 ? "empty" : notionNotes.length > 0 ? "notion" : "operations";

  // 섭외지양 표기 대상. 노션 강사 DB의 "섭외지양 여부"만 본다(수동 토글 없음).
  const recruitAvoidNames = notes
    .filter((note) => note.notion?.recruitAvoid)
    .map((note) => (note.instructorName ?? "").trim())
    .filter(Boolean);

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
