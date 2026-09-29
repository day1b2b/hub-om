import { getCoachManagerMyPageRepository } from "./coachManagerMyPageRepositoryFactory";
import type { MyActiveReservation, MyConfirmedCourse } from "./coachManagerMyPageRepository";

export type { MyActiveReservation, MyConfirmedCourse, MyConfirmedCourseCoach, MyConfirmedCourseRound } from "./coachManagerMyPageRepository";
export { partitionConfirmedCourses, type PartitionedConfirmedCourses } from "./coachMyPagePresentation";

// Keep the existing page API while selecting storage at the explicit request boundary.
export async function listMyActiveReservations(email: string): Promise<MyActiveReservation[]> {
  return getCoachManagerMyPageRepository().listMyActiveReservations(email);
}

export async function listMyConfirmedCourses(email: string): Promise<MyConfirmedCourse[]> {
  return getCoachManagerMyPageRepository().listMyConfirmedCourses(email);
}
