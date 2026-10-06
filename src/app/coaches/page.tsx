import { CoachList } from "@/features/coaches/CoachList";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import type { CoachSummary } from "@/lib/data/coachTypes";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";

export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  await requireAdminSession();
  return runCoachPublicRequest(renderCoachesPage);
}

async function renderCoachesPage() {
  let coaches: CoachSummary[] = [];
  let loadFailed = false;

  try {
    coaches = await getCoachRepository().listCoaches();
  } catch {
    loadFailed = true;
  }

  return <CoachList coaches={coaches} loadFailed={loadFailed} />;
}
