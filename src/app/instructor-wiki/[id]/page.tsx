import { notFound } from "next/navigation";
import { InstructorWikiDetail } from "@/features/wiki/InstructorWikiDetail";
import { aggregateInstructors, type InstructorWikiEntry } from "@/features/wiki/instructorWikiModel";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

interface InstructorWikiDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function InstructorWikiDetailPage({ params }: InstructorWikiDetailPageProps) {
  await requireWorkspaceSession();
  const { id } = await params;
  const name = safeDecode(id);

  let entry: InstructorWikiEntry | undefined;
  try {
    const operations = await getOperationRepository().listOperations();
    entry = aggregateInstructors(operations).find((item) => item.name === name);
  } catch {
    entry = undefined;
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
