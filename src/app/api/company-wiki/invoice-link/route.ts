import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { isSafeHttpUrl } from "@/components/ExternalTableLink";
import { getCompanyBusinessInfoRepository } from "@/lib/data/companyBusinessInfoRepositoryFactory";
import { runCompanyBusinessInfoRequest } from "@/lib/data/companyBusinessInfoComposition";
import { buildInvoiceRequestFormUrl } from "@/lib/data/invoiceRequestForm";

interface CourseInput {
  key: string;
  courseId: string;
  courseName: string;
}

/**
 * 기업위키 상세의 코스별 "계산서 발행 요청" 링크를 서버에서 만들어 돌려준다.
 * 구글폼 URL(INVOICE_REQUEST_FORM_URL)을 클라이언트 번들에 절대 포함시키지 않기 위해,
 * 완성된 링크만 응답으로 보낸다 — 저장소가 public이라 폼 URL 자체는 코드에 없다.
 */
async function activityPOST(request: Request) {
  await requireWorkspaceSession();
  const body = (await request.json()) as { companyId?: string | null; companyName?: string; courses?: CourseInput[] };
  const courses = Array.isArray(body.courses) ? body.courses.slice(0, 200) : [];
  if (!body.companyName || courses.length === 0) {
    return NextResponse.json({ error: "companyName·courses 필요" }, { status: 400 });
  }

  try {
    const businessInfo = body.companyId ? await getCompanyBusinessInfoRepository().get(body.companyId) : null;
    const links: Record<string, string | null> = {};
    for (const course of courses) {
      const href = buildInvoiceRequestFormUrl({
        courseId: course.courseId,
        courseName: course.courseName,
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
    }
    return NextResponse.json({ links });
  } catch {
    return NextResponse.json({ error: "링크 생성 실패" }, { status: 500 });
  }
}

export const POST = withActivity("/api/company-wiki/invoice-link", "POST", activityPOST, runCompanyBusinessInfoRequest);
