import { notFound } from "next/navigation";
import { CoachDetailView } from "@/features/coaches/CoachDetail";
import { isAdminEmail } from "@/lib/auth/requireAdminSession";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { readCoachPrivateProfile } from "@/lib/data/coachPrivateAccess";

export const dynamic = "force-dynamic";

interface CoachDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachDetailPage({ params }: CoachDetailPageProps) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const admin = isAdminEmail(session.user?.email);

  const coach = await getCoachRepository().getCoachById(id);

  if (!coach) {
    notFound();
  }

  // PII는 admin일 때만 서버사이드에서 조회한다. (비-admin이 호출하면 throw)
  const privateProfile = admin ? await readCoachPrivateProfile(id, "coach_detail") : null;

  return <CoachDetailView coach={coach} privateProfile={privateProfile} />;
}
