import { getPrismaClient } from "./prisma";
import type { CoachOwnProfile, CoachTokenRepository, PublicCoachTokenContext } from "./coachTokenRepository";

/** Existing token and /api/coach/me queries, retained as the default production adapter. */
export class PrismaCoachTokenRepository implements CoachTokenRepository {
  async findByToken(token: string): Promise<PublicCoachTokenContext | null> {
    if (!token) return null;
    const coach = await getPrismaClient().coach.findFirst({
      where: { accessToken: token, deletedAt: null },
      select: { id: true, sourceCoachId: true, name: true, workType: true, status: true, accessToken: true }
    });
    if (!coach?.accessToken) return null;
    return { ...coach, accessToken: coach.accessToken };
  }
  async getOwnProfile(token: string): Promise<CoachOwnProfile | null> {
    const coach = await this.findByToken(token);
    if (!coach) return null;
    const prisma = getPrismaClient();
    const [profile, archivedRows] = await Promise.all([
      prisma.coach.findUnique({
        where: { id: coach.id },
        select: {
          fields: { select: { tag: { select: { id: true, name: true } } } },
          curriculums: { select: { tag: { select: { id: true, name: true } } } }
        }
      }),
      prisma.coachdbArchiveRow.findMany({
        where: { snapshot: { status: "completed" }, tableSchema: "public", tableName: "coaches", rowKey: coach.sourceCoachId },
        orderBy: { snapshot: { startedAt: "desc" } }, take: 1, select: { rowData: true }
      })
    ]);
    const archived = (archivedRows[0]?.rowData ?? {}) as Record<string, unknown>;
    return {
      id: coach.id, name: coach.name, status: coach.status.toLowerCase(), workType: coach.workType,
      availabilityDetail: typeof archived.availability_detail === "string" && archived.availability_detail.trim() ? archived.availability_detail : null,
      fields: profile?.fields.map(field => ({ id: field.tag.id, name: field.tag.name })) ?? [],
      curriculums: profile?.curriculums.map(curriculum => ({ id: curriculum.tag.id, name: curriculum.tag.name })) ?? []
    };
  }
}
