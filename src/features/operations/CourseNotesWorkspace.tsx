"use client";

import type { CourseCommonNote as CourseCommonNoteValue } from "@/lib/data/operationTypes";
import { CourseCommonNote } from "./CourseCommonNote";

/**
 * 과정 공통 메모와 회차별 메모를 탭으로 나누던 화면을 과정 공통 메모 단일 섹션으로 합쳤다.
 * 기존 회차별 메모(operation_sessions.specialNotes/operationIssue/omUpdate)는 DB에 그대로 남아 있고,
 * 과정 전환 시점에 npm run db:merge:course-and-round-notes로 과정 공통 메모에 이어붙여 반영한다.
 * 회차별 편집 UI(IssueReviewEditor)는 이 화면에서 더는 쓰지 않지만 롤백/참고용으로 코드를 지우지 않았다.
 */
export function CourseNotesWorkspace({
  className = "",
  commonNote,
  operationId
}: {
  className?: string;
  commonNote?: CourseCommonNoteValue;
  operationId: string;
}) {
  return <section id="operation-notes" className={`course-notes-workspace detail-section ${className}`}>
    <div className="section-title"><h2>메모</h2></div>
    <CourseCommonNote note={commonNote} operationId={operationId} />
  </section>;
}
