import { notFound, redirect } from "next/navigation";
import { InstructorWikiDetail } from "@/features/wiki/InstructorWikiDetail";
import {
  aggregateInstructors,
  applyNotionLinks,
  type InstructorWikiEntry
} from "@/features/wiki/instructorWikiModel";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import {
  getAllInstructorNotes,
  getInstructorNote,
  resolveNotionLinkTargets
} from "@/lib/data/instructorWikiStore";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

interface InstructorWikiDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function InstructorWikiDetailPage({ params }: InstructorWikiDetailPageProps) {
  await requireAdminSession();
  const { id } = await params;
  const name = safeDecode(id);

  const notes = await getAllInstructorNotes();
  const linkTargets = resolveNotionLinkTargets(notes);

  // 이 표기가 노션 강사에 연결돼 있으면 정본(노션 강사명) 주소로 보낸다.
  const linkedTo = linkTargets[name];
  if (linkedTo && linkedTo !== name) {
    redirect(`/instructor-wiki/${encodeURIComponent(linkedTo)}`);
  }

  let entry: InstructorWikiEntry | undefined;
  try {
    const operations = await getOperationRepository().listOperations();
    entry = applyNotionLinks(aggregateInstructors(operations), linkTargets).find((item) => item.name === name);
  } catch {
    entry = undefined;
  }

  // 운영 배정 이력이 없어도 노션 강사 DB에 있으면 상세를 연다(코스는 빈 상태로).
  // 목록이 노션 명단 기준이라, 여기서 막으면 목록에서 클릭해도 404가 난다.
  if (!entry) {
    const note = await getInstructorNote(name);
    if (note?.notion) {
      entry = {
        id: name,
        name,
        companies: [],
        courseCount: 0,
        courses: [],
        coach: null,
        categories: note.notion.categories ?? []
      };
    }
  }

  if (!entry) {
    notFound();
  }

  // coach-db 연결 시 전문분야/평가/커리큘럼 보강(best-effort).
  try {
    const repository = getCoachRepository();
    const coaches = await repository.listCoaches();
    const matched = coaches.find((coach) => coach.name.trim() === entry.name.trim());
    if (matched) {
      const detail = await repository.getCoachById(matched.id);
      if (detail) {
        entry.coach = {
          coachId: detail.id,
          status: detail.status,
          workType: detail.workType,
          fields: detail.fields,
          avgRating: detail.avgRating,
          curriculums: detail.curriculums
        };
      }
    }
  } catch {
    // coach-db 미연결 → 보강 생략
  }

  return <InstructorWikiDetail entry={entry} />;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
