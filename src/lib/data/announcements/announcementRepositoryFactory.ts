import { getDataRepositoryOverride } from "../dataRepositoryContext";
import type { AnnouncementRepository } from "./announcementRepository";
import { PrismaAnnouncementRepository } from "./prismaAnnouncementRepository";

export function getAnnouncementRepository(): AnnouncementRepository {
  return getDataRepositoryOverride("announcements") ?? new PrismaAnnouncementRepository();
}
