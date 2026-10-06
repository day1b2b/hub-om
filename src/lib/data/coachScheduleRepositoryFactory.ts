import type { CoachScheduleRepository } from "./coachScheduleRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachScheduleRepository } from "./prismaCoachScheduleRepository";

export function getCoachScheduleRepository(): CoachScheduleRepository {
  return getDataRepositoryOverride("coachSchedule") ?? new PrismaCoachScheduleRepository();
}
