import { CoachList } from "@/features/coaches/CoachList";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import type { CoachSummary } from "@/lib/data/coachTypes";

export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  await requireWorkspaceSession();

  let coaches: CoachSummary[] = [];
  let loadFailed = false;

  try {
    coaches = await getCoachRepository().listCoaches();
  } catch {
    loadFailed = true;
  }

  return <CoachList coaches={coaches} loadFailed={loadFailed} />;
}
