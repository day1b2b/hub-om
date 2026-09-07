"use client";
import { useState } from "react";
import { ActivityPanel } from "@/app/admin/activity/ActivityPanel";
import { ContentManagementSection } from "./ContentManagementSection";
export function ChangesWorkspace() {
  const [revision, setRevision] = useState(0);
  return <><p><a href="#content">메모·리뷰 관리로 이동 ↓</a></p><ActivityPanel key={revision} mode="changes" /><ContentManagementSection onChanged={() => setRevision(v => v + 1)} /></>;
}
