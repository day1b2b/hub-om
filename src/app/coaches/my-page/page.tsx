import { CoachMyPage } from "@/features/coaches/CoachMyPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listMyActiveReservations, listMyConfirmedCourses } from "@/lib/data/coachMyPage";

export const dynamic = "force-dynamic";

export default async function CoachMyPageRoute() {
  const session = await requireWorkspaceSession();
  const email = session.user?.email ?? "";

  const [reservations, confirmedCourses] = await Promise.all([
    listMyActiveReservations(email),
    listMyConfirmedCourses(email)
  ]);

  return <CoachMyPage confirmedCourses={confirmedCourses} reservations={reservations} />;
}
