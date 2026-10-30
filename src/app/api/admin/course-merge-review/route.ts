import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { buildCourseMergeReviewRows, courseMergeReviewCsv } from "@/lib/data/courseMergeReview";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getOmRequestRepository } from "@/lib/data/omRequest/omRequestRepositoryFactory";
import { runOperationPagesRequest } from "@/lib/data/operationPagesComposition";

export const dynamic = "force-dynamic";

/**
 * 과정 단위 통합 뒤 담당자가 직접 골라야 하는 항목(강의관리 링크·메모, 공통 메모, 링크가 아닌 싱크업)을
 * 회차별 값과 함께 CSV로 내려준다. 메모 원문이 들어가므로 관리자만 받을 수 있다.
 */
async function activityGET() {
  await assertAdminSession();
  const [operations, requests] = await Promise.all([getOperationRepository().listOperations(), getOmRequestRepository().listOmRequests()]);
  const csv = courseMergeReviewCsv(buildCourseMergeReviewRows(operations, requests));
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="course_merge_review_${date}.csv"`,
      "cache-control": "no-store"
    }
  });
}

export const GET = withActivity("/api/admin/course-merge-review", "GET", activityGET, runOperationPagesRequest);
