/** Rotation returns null for missing/deleted coaches; callers retain workspace authorization. */
export interface CoachTokenRotationRepository {
  regenerateToken(coachId: string): Promise<{ id: string; accessToken: string } | null>;
}
