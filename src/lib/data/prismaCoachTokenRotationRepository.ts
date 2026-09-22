import { generateCoachAccessToken } from "../coaches/accessToken";
import { getPrismaClient } from "./prisma";
import type { CoachTokenRotationRepository } from "./coachTokenRotationRepository";

export class PrismaCoachTokenRotationRepository implements CoachTokenRotationRepository {
  async regenerateToken(coachId: string): Promise<{ id: string; accessToken: string } | null> {
    try {
      // The live-row predicate is part of UPDATE itself, including concurrent soft deletion.
      const row = await getPrismaClient().coach.update({
        where: { id: coachId, deletedAt: null },
        data: { accessToken: generateCoachAccessToken() },
        select: { id: true, accessToken: true }
      });
      if (row.accessToken === null) throw new Error("COACH_TOKEN_ROTATION_FAILED");
      return { id: row.id, accessToken: row.accessToken };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2025") return null;
      throw new Error("COACH_TOKEN_ROTATION_FAILED");
    }
  }
}
