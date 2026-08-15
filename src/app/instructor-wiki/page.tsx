import { InstructorWiki } from "@/features/wiki/InstructorWiki";
import {
  aggregateInstructors,
  attachCoachSummaries,
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

  try {
    const operations = await getOperationRepository().listOperations();
    entries = aggregateInstructors(operations);
  } catch {
    loadFailed = true;
  }

  // coach-db 연결 시 전문분야/평가 보강(best-effort). 미연결이면 조용히 건너뛴다.
  try {
    const coaches = await getCoachRepository().listCoaches();
    if (coaches.length > 0) {
      attachCoachSummaries(entries, coaches);
    }
  } catch {
    // coach-db 미연결(로컬 dev 등) → 보강 생략
  }

  const provenance: InstructorWikiProvenance = entries.length > 0 ? "operations" : "empty";

  // OM이 "섭외 지양"으로 저장한 강사명 목록(목록 화면 표시용).
  const notes = await getAllInstructorNotes();
  const recruitAvoidNames = Object.keys(notes).filter((name) => notes[name]?.recruitAvoid);

  return (
    <InstructorWiki
      entries={entries}
      loadFailed={loadFailed}
      provenance={provenance}
      recruitAvoidNames={recruitAvoidNames}
    />
  );
}
