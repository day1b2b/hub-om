import { InstructorWiki } from "@/features/wiki/InstructorWiki";
import {
  aggregateInstructors,
  attachCoachSummaries,
  type InstructorWikiEntry,
  type InstructorWikiProvenance
} from "@/features/wiki/instructorWikiModel";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { getAllInstructorNotes, notionHref } from "@/lib/data/instructorWikiStore";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function InstructorWikiPage() {
  await requireWorkspaceSession();

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
  const notes = getAllInstructorNotes();
  const recruitAvoidNames = Object.keys(notes).filter((name) => notes[name]?.recruitAvoid);
  // 강사명 → 노션 링크(고유 ID 기반). 저장된 강사만 포함.
  const notionLinks: Record<string, string> = {};
  for (const [instructorName, note] of Object.entries(notes)) {
    const href = notionHref(note.notionId);
    if (href) notionLinks[instructorName] = href;
  }

  return (
    <InstructorWiki
      entries={entries}
      loadFailed={loadFailed}
      provenance={provenance}
      recruitAvoidNames={recruitAvoidNames}
      notionLinks={notionLinks}
    />
  );
}
