import { getPrismaClient } from "../prisma";
import type { AnnouncementRepository, AnnouncementCreateInput, AnnouncementUpdateInput } from "./announcementRepository";

/** The production PostgreSQL queries retain their original projections and nested writes. */
export class PrismaAnnouncementRepository implements AnnouncementRepository {
  async list() {
    const prisma = getPrismaClient();
    return prisma.announcement.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        authorName: true,
        authorEmail: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }
  async getDetail(id: string) {
    const prisma = getPrismaClient();
    return prisma.announcement.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        content: true,
        authorName: true,
        authorEmail: true,
        createdAt: true,
        updatedAt: true,
        attachments: {
          select: { id: true, fileName: true, mimeType: true, size: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });
  }
  async getDetailPage(id: string) {
    const prisma = getPrismaClient();
    return prisma.announcement.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        content: true,
        authorName: true,
        authorEmail: true,
        createdAt: true,
        attachments: {
          select: { id: true, fileName: true, size: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });
  }
  async getEditPage(id: string) {
    const prisma = getPrismaClient();
    return prisma.announcement.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        content: true,
        attachments: {
          select: { id: true, fileName: true, size: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });
  }
  async getUpdateState(id: string) {
    const prisma = getPrismaClient();
    return prisma.announcement.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, _count: { select: { attachments: true } } }
    });
  }
  async getDeleteState(id: string) {
    return getPrismaClient().announcement.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  }
  async create(input: AnnouncementCreateInput) {
    const prisma = getPrismaClient();
    return prisma.announcement.create({
      data: {
        title: input.title,
        content: input.content,
        authorEmail: input.authorEmail,
        authorName: input.authorName,
        attachments: { create: input.attachments.map(file => ({ ...file, data: Buffer.from(file.data) })) }
      },
      select: {
        id: true,
        title: true,
        content: true,
        authorName: true,
        authorEmail: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }
  async update(input: AnnouncementUpdateInput) {
    const prisma = getPrismaClient();
    return prisma.announcement.update({
      where: { id: input.id },
      data: {
        title: input.title,
        content: input.content,
        attachments: {
          deleteMany: input.removeAttachmentIds.length ? { id: { in: input.removeAttachmentIds } } : undefined,
          create: input.attachments.map(file => ({ ...file, data: Buffer.from(file.data) }))
        }
      },
      select: {
        id: true,
        title: true,
        content: true,
        authorName: true,
        authorEmail: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }
  async softDelete(id: string, deletedBy: string | null): Promise<void> {
    await getPrismaClient().announcement.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy }
    });
  }
  async download(id: string, attachmentId: string) {
    const prisma = getPrismaClient();
    return prisma.announcementAttachment.findFirst({
      where: { id: attachmentId, announcementId: id, announcement: { deletedAt: null } },
      select: { fileName: true, mimeType: true, data: true }
    });
  }
}
