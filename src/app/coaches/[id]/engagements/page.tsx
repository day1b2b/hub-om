import { notFound } from "next/navigation";
import { CoachEngagementList } from "@/features/coaches/CoachEngagementList";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";

export const dynamic = "force-dynamic";

interface CoachEngagementsPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachEngagementsPage({ params }: CoachEngagementsPageProps) {
  await requireAdminSession();
  return runCoachPublicRequest(() => renderCoachEngagementsPage(params));
}

async function renderCoachEngagementsPage(params: CoachEngagementsPageProps["params"]) {
  const { id } = await params;

  const repository = getCoachRepository();
  const coach = await repository.getCoachById(id);

  if (!coach) {
    notFound();
  }

  const engagements = await repository.listEngagements(id);

  return (
    <CoachEngagementList
      coachId={id}
      coachName={coach.name}
      engagements={engagements}
      feedbackByEngagement={{}}
    />
  );
}
