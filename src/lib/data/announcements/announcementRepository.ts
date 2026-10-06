export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  authorEmail: string;
  authorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type AnnouncementListRow = Omit<AnnouncementRecord, "content">;
export interface AnnouncementFileInput {
  fileName: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
}
export interface AnnouncementAttachmentRow {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}
export type AnnouncementDetailRow = AnnouncementRecord & { attachments: AnnouncementAttachmentRow[] };
export type AnnouncementDetailPageRow = Omit<AnnouncementRecord, "updatedAt"> & { attachments: Omit<AnnouncementAttachmentRow, "mimeType">[] };
export type AnnouncementEditPageRow = Pick<AnnouncementRecord, "id" | "title" | "content"> & { attachments: Omit<AnnouncementAttachmentRow, "mimeType">[] };
export interface AnnouncementDeleteState { id: string; deletedAt: Date | null }
export interface AnnouncementUpdateState extends AnnouncementDeleteState { _count: { attachments: number } }
export interface AnnouncementCreateInput {
  title: string;
  content: string;
  authorEmail: string;
  authorName: string | null;
  attachments: AnnouncementFileInput[];
}
export interface AnnouncementUpdateInput {
  id: string;
  title: string;
  content: string;
  removeAttachmentIds: string[];
  attachments: AnnouncementFileInput[];
}
/** Storage boundary only: existing routes own auth, sanitization and preflight validation. */
export interface AnnouncementRepository {
  list(): Promise<AnnouncementListRow[]>;
  getDetail(id: string): Promise<AnnouncementDetailRow | null>;
  getDetailPage(id: string): Promise<AnnouncementDetailPageRow | null>;
  getEditPage(id: string): Promise<AnnouncementEditPageRow | null>;
  getUpdateState(id: string): Promise<AnnouncementUpdateState | null>;
  getDeleteState(id: string): Promise<AnnouncementDeleteState | null>;
  create(input: AnnouncementCreateInput): Promise<AnnouncementRecord>;
  update(input: AnnouncementUpdateInput): Promise<AnnouncementRecord>;
  softDelete(id: string, deletedBy: string | null): Promise<void>;
  download(id: string, attachmentId: string): Promise<{ fileName: string; mimeType: string; data: Uint8Array } | null>;
}
