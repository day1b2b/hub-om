"use client";

// 운영현황 교육상세 "계산서 발행 요청 현황" 구역. 강사 계약 현황 옆에 같은 크기로 놓인다.
// 기업위키 상세와 같은 API(/api/company-wiki/invoice-link)로 이 과정 하나의 폼 링크·요청 현황을 받는다 —
// 구글폼 URL은 서버에만 두고, 사업자등록증 정보도 서버에서 기업위키 값으로 채운다.
import { useEffect, useState } from "react";
import { InvoiceRequestLink, InvoiceRequestStatusBadge, type InvoiceRequestStatusView } from "@/features/wiki/InvoiceRequest";

interface CourseInvoiceRequestSectionProps {
  companyId?: string;
  companyName: string;
  courseId: string;
  courseIdLabel: string;
}

const COURSE_KEY = "course";

export function CourseInvoiceRequestSection({ companyId, companyName, courseId, courseIdLabel }: CourseInvoiceRequestSectionProps) {
  const trimmedCourseId = courseId.trim();
  // undefined면 아직 불러오는 중, null이면 링크를 못 만들었음(화면은 둘 다 "-").
  const [href, setHref] = useState<string | null | undefined>(undefined);
  const [statuses, setStatuses] = useState<{ available: boolean; status: InvoiceRequestStatusView | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/company-wiki/invoice-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: companyId || null,
        companyName,
        courses: [{ key: COURSE_KEY, courseId: trimmedCourseId, courseIdLabel: courseIdLabel.trim() }]
      })
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setHref(data?.links?.[COURSE_KEY] ?? null);
        setStatuses({ available: data?.statusAvailable === true, status: data?.statuses?.[COURSE_KEY] ?? null });
      })
      .catch(() => {
        if (cancelled) return;
        setHref(null);
        setStatuses({ available: false, status: null });
      });
    return () => { cancelled = true; };
  }, [companyId, companyName, courseIdLabel, trimmedCourseId]);

  return (
    <section className="detail-section course-invoice-section">
      <div className="section-title">
        <h2>계산서 발행 요청 현황</h2>
      </div>
      <dl className="course-invoice-rows">
        <div>
          <dt>코스ID</dt>
          <dd>{trimmedCourseId || "검토필요"}</dd>
        </div>
        <div>
          <dt>계산서 발행 요청</dt>
          <dd><InvoiceRequestLink href={href} /></dd>
        </div>
        <div>
          <dt>발행 요청 현황</dt>
          <dd>
            <InvoiceRequestStatusBadge
              hasCourseId={Boolean(trimmedCourseId)}
              state={statuses}
              status={statuses?.status ?? null}
            />
            {statuses?.status?.lastRequestedAt ? (
              <span className="course-invoice-last">마지막 요청 {statuses.status.lastRequestedAt}</span>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="course-invoice-hint">사업자등록증 정보는 기업위키에 등록된 값으로 자동 기입됩니다.</p>
    </section>
  );
}
