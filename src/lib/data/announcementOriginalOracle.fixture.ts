/** Frozen query/select/nested-write expressions extracted verbatim from 5f9d291.
 * Only route locals (parsed input/session) are bound by this independent adapter.
 * No production repository, presenter, normalizer or selector is imported.
 */
import { getPrismaClient } from "./prisma";
type FileInput = { fileName: string; mimeType: string; size: number; data: Uint8Array };
type CreateInput = { title: string; content: string; authorEmail: string; authorName: string | null; attachments: FileInput[] };
type UpdateInput = { id: string; title: string; content: string; removeAttachmentIds: string[]; attachments: FileInput[] };
export function originalAnnouncementOracle(prisma: ReturnType<typeof getPrismaClient>) {
 return {
  async list() { return prisma.announcement.findMany({
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
  }); },
  async getDetail(id: string) { return prisma.announcement.findFirst({
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
  }); },
  async getDetailPage(id: string) { return prisma.announcement.findFirst({
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
  }); },
  async getEditPage(id: string) { return prisma.announcement.findFirst({
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
  }); },
  async getUpdateState(id: string) { return prisma.announcement.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, _count: { select: { attachments: true } } }
  }); },
  async getDeleteState(id: string) { return prisma.announcement.findUnique({ where: { id }, select: { id: true, deletedAt: true } }); },
  async download(id: string, attachmentId: string) { return prisma.announcementAttachment.findFirst({
    where: { id: attachmentId, announcementId: id, announcement: { deletedAt: null } },
    select: { fileName: true, mimeType: true, data: true }
  }); },
  async create(input: CreateInput) {
 const {title, content}=input; const attachmentsData=input.attachments.map(file => ({ ...file, data: Buffer.from(file.data) })); const session={user:{email:input.authorEmail,name:input.authorName}};
 return prisma.announcement.create({
    data: {
      title,
      content,
      authorEmail: session.user?.email ?? "",
      authorName: session.user?.name ?? null,
      attachments: { create: attachmentsData }
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
 },
  async update(input: UpdateInput) {
 const {id,title,content,removeAttachmentIds}=input; const attachmentsData=input.attachments.map(file => ({ ...file, data: Buffer.from(file.data) }));
 return prisma.announcement.update({
    where: { id },
    data: {
      title,
      content,
      attachments: {
        deleteMany: removeAttachmentIds.length ? { id: { in: removeAttachmentIds } } : undefined,
        create: attachmentsData
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
 },
  async softDelete(id: string, deletedBy: string | null): Promise<void> {
 const session={user:{email:deletedBy}};
 await prisma.announcement.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: session.user?.email ?? null
    }
  });
 }
 };
}
