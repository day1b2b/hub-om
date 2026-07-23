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
}
