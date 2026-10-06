import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { TeamMemberImportEntry, TeamMemberImportRepository } from "./teamMemberImportRepository";

export class PrismaTeamMemberImportRepository implements TeamMemberImportRepository {
  private readonly client: PrismaClient;
  constructor(client: PrismaClient = getPrismaClient()) { this.client = client; }

  async importMembers(entries: readonly TeamMemberImportEntry[], apply: boolean) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.client.$transaction(async tx => {
          let inserted = 0, updated = 0, deactivated = 0;
          const known = new Set<string>();
          for (const entry of entries) {
            const naturalKey = { role: entry.role, sourceTeam: entry.sourceTeam, normalizedName: entry.normalizedName } as const;
            const identity = JSON.stringify([entry.role, entry.sourceTeam, entry.normalizedName]);
            const existing = known.has(identity) ? true : (await tx.member.findMany({ where: naturalKey, select: { id: true } })).length > 0;
            known.add(identity); if (existing) updated++; else inserted++;
            if (apply) {
              const data = { name: entry.name, roleTitle: entry.roleTitle, calendarId: entry.calendarId, isActive: true, displayOrder: entry.displayOrder };
              if (existing) await tx.member.updateMany({ where: naturalKey, data });
              else await tx.member.create({ data: { ...entry, isActive: true } });
            }
          }
          for (const group of groups(entries)) {
            const where = { role: group.role, sourceTeam: group.sourceTeam, normalizedName: { notIn: group.normalizedNames }, isActive: true } as const;
            const count = await tx.member.count({ where });
            deactivated += count;
            if (apply && count) await tx.member.updateMany({ where, data: { isActive: false } });
          }
          return { total: entries.length, inserted, updated, deactivated };
        }, { isolationLevel: apply ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 30_000 });
      } catch (error) {
        if (apply && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 4) continue;
        throw new Error("TEAM_MEMBER_IMPORT_FAILED");
      }
    }
    throw new Error("TEAM_MEMBER_IMPORT_FAILED");
  }
}

function groups(entries: readonly TeamMemberImportEntry[]) {
  const values = new Map<string, { role: TeamMemberImportEntry["role"]; sourceTeam: TeamMemberImportEntry["sourceTeam"]; normalizedNames: string[] }>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.role, entry.sourceTeam]);
    const group = values.get(key) ?? { role: entry.role, sourceTeam: entry.sourceTeam, normalizedNames: [] };
    group.normalizedNames.push(entry.normalizedName); values.set(key, group);
  }
  return values.values();
}
