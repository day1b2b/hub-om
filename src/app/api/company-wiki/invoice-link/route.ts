import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { isSafeHttpUrl } from "@/components/ExternalTableLink";
import { getCompanyBusinessInfoRepository } from "@/lib/data/companyBusinessInfoRepositoryFactory";
import { runCompanyBusinessInfoRequest } from "@/lib/data/companyBusinessInfoComposition";
import { buildInvoiceRequestFormUrl } from "@/lib/data/invoiceRequestForm";
import { loadInvoiceRequestStatuses, type InvoiceRequestStatus } from "@/lib/data/invoiceRequestStatus";
import { normalizeCourseId } from "@/lib/data/operationCalculations";

interface CourseInput {
  key: string;
  courseId: string;
  courseIdLabel: string;
}

/**
 * 기업위키 상세의 코스별 "계산서 발행 요청" 링크를 서버에서 만들어 돌려준다.
 * 구글폼 URL(INVOICE_REQUEST_FORM_URL)을 클라이언트 번들에 절대 포함시키지 않기 위해,
 * 완성된 링크만 응답으로 보낸다 — 저장소가 public이라 폼 URL 자체는 코드에 없다.
 *
 * 같은 응답에 코스ID별 "발행 요청 현황"(폼 응답 시트에 그 코스ID 요청이 있는지)도 담는다.
 * statusAvailable=false면 시트를 못 읽은 것이라, 화면은 "미요청"이 아니라 "확인 불가"로 보여야 한다.
 */
async function activityPOST(request: Request) {
  await requireWorkspaceSession();
  const body = (await request.json()) as { companyId?: string | null; companyName?: string; courses?: CourseInput[] };
  const courses = Array.isArray(body.courses) ? body.courses.slice(0, 200) : [];
  if (!body.companyName || courses.length === 0) {
    return NextResponse.json({ error: "companyName·courses 필요" }, { status: 400 });
  }

  try {
    const [businessInfo, requestStatuses] = await Promise.all([
      body.companyId ? getCompanyBusinessInfoRepository().get(body.companyId) : null,
      loadInvoiceRequestStatuses()
    ]);
    const statuses: Record<string, InvoiceRequestStatus | null> = {};
    const links: Record<string, string | null> = {};
    for (const course of courses) {
      const href = buildInvoiceRequestFormUrl({
        courseId: course.courseId,
        // 구글폼 "과정명"은 코스ID명(courseIdLabel)을 쓴다 — 미정(빈 값)이면 폼 칸도 비워 둔다.
        courseName: course.courseIdLabel,
        companyName: body.companyName,
        businessNumber: businessInfo?.businessNumber,
        representativeName: businessInfo?.representativeName,
        address: businessInfo?.address,
        businessType: businessInfo?.businessType,
        businessItem: businessInfo?.businessItem,
        invoiceEmail: businessInfo?.invoiceEmail,
        invoiceEmailSecondary: businessInfo?.invoiceEmailSecondary
      });
      links[course.key] = isSafeHttpUrl(href) ? href : null;
      const courseId = normalizeCourseId(course.courseId);
      statuses[course.key] = requestStatuses.ok && courseId ? requestStatuses.byCourseId.get(courseId) ?? null : null;
    }
    return NextResponse.json({ links, statuses, statusAvailable: requestStatuses.ok });
  } catch {
    return NextResponse.json({ error: "링크 생성 실패" }, { status: 500 });
  }
}

export const POST = withActivity("/api/company-wiki/invoice-link", "POST", activityPOST, runCompanyBusinessInfoRequest);
