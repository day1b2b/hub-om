import { notFound } from "next/navigation";
import { CoachEngagementList } from "@/features/coaches/CoachEngagementList";
import { isAdminEmail } from "@/lib/auth/requireAdminSession";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { readCoachEngagementFeedback } from "@/lib/data/coachPrivateAccess";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";

export const dynamic = "force-dynamic";

interface CoachEngagementsPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachEngagementsPage({ params }: CoachEngagementsPageProps) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const admin = isAdminEmail(session.user?.email);

  const repository = getCoachRepository();
  const coach = await repository.getCoachById(id);

  if (!coach) {
    notFound();
  }

  const engagements = await repository.listEngagements(id);

  // 피드백/hiredBy는 PII로 취급한다. admin일 때만 서버사이드에서 조회한다.
  const feedbackByEngagement = admin
    ? Object.fromEntries(
        (await readCoachEngagementFeedback(id, "engagement_feedback")).map((item) => [
          item.engagementId,
          { feedback: item.feedback, hiredByText: item.hiredByText }
        ])
      )
    : {};

  return (
    <CoachEngagementList
      coachId={id}
      coachName={coach.name}
      engagements={engagements}
      feedbackByEngagement={feedbackByEngagement}
    />
  );
}
