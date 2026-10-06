export interface MyActiveReservation {
  coachId: string;
  coachName: string;
  date: string;
}

export interface MyConfirmedCourseRound {
  date: string;
  startTime: string;
  endTime: string;
}

export interface MyConfirmedCourseCoach {
  coachId: string;
  coachName: string;
  engagementId: string;
  startDate: string;
  endDate: string;
  statusLabel: string;
  rating: number | null;
  feedback: string | null;
  rehire: boolean | null;
  rounds: MyConfirmedCourseRound[];
}

export interface MyConfirmedCourse {
  courseName: string;
  startDate: string;
  endDate: string;
  coaches: MyConfirmedCourseCoach[];
}

/** Read-only manager my-page contract. Dates in DTOs retain YYYY-MM-DD formatting.
 * An empty email returns []; nonempty reservation emails are matched without trimming.
 * Storage selection never grants access: authorization remains with the existing page.
 */
export interface CoachManagerMyPageRepository {
  listMyActiveReservations(email: string): Promise<MyActiveReservation[]>;
  listMyConfirmedCourses(email: string): Promise<MyConfirmedCourse[]>;
}
