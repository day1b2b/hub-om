export interface AnnouncementSummary {
  id: string;
  title: string;
  authorName: string | null;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementDetail extends AnnouncementSummary {
  content: string;
  attachments: AnnouncementAttachmentSummary[];
}

export interface AnnouncementAttachmentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}
