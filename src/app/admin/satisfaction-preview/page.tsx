import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { SatisfactionMatchPreview } from "@/features/admin/SatisfactionMatchPreview";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { isSatisfactionMatchingEnabled } from "@/lib/auth/satisfactionMatchingAccess";

export const dynamic = "force-dynamic";

export default async function SatisfactionPreviewPage() {
  if (!isSatisfactionMatchingEnabled()) notFound();
  await requireAdminSession();

  return (
    <main className="dashboard-shell">
      <AppSidebar label="데이터 관리" teamScope="both" />

      <section className="content satisfaction-match">
        <header className="page-header">
          <div>
            <p className="eyebrow">만족도 매칭</p>
            <h1>만족도 매칭</h1>
            <p className="lede">
              팀 집계 시트를 자동으로 읽어 최신 매칭 상태를 보여줍니다. 조회만 하며 실제 데이터는 바꾸지 않습니다.
              자동연결 건은 아래 버튼으로 운영 회차 만족도에 반영할 수 있습니다.
            </p>
          </div>
          <Link className="primary-link" href="/">
            운영 목록
          </Link>
        </header>

        <SatisfactionMatchPreview />
      </section>
    </main>
  );
}
