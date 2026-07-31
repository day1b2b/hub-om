import { CoachMyPage } from "@/features/coaches/CoachMyPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listMyActiveReservations, listMyConfirmedCourses, partitionConfirmedCourses } from "@/lib/data/coachMyPage";

export const dynamic = "force-dynamic";

export default async function CoachMyPageRoute() {
  const session = await requireWorkspaceSession();
  const email = session.user?.email ?? "";

  const [reservations, confirmedCourses] = await Promise.all([
    listMyActiveReservations(email),
    listMyConfirmedCourses(email)
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const { inProgress, past } = partitionConfirmedCourses(confirmedCourses, todayIso);

  return <CoachMyPage inProgressCourses={inProgress} pastCourses={past} reservations={reservations} todayIso={todayIso} />;
}
