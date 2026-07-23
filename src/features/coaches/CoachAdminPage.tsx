import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";

export type CoachAdminTab = "schedule-link" | "deleted" | "managers" | "sync" | "content";

const TABS: Array<{ tab: CoachAdminTab; label: string }> = [
  { tab: "schedule-link", label: "일정 등록 링크" },
  { tab: "deleted", label: "삭제 내역" },
  { tab: "managers", label: "매니저" },
  { tab: "sync", label: "동기화" },
  { tab: "content", label: "콘텐츠 관리" }
];

interface CoachAdminPageProps {
  selectedTab: CoachAdminTab;
}

export function CoachAdminPage({ selectedTab }: CoachAdminPageProps) {
  return (
    <main className="dashboard-shell coach-schedule-shell">
      <AppSidebar label="Coach admin" teamScope="both" />

      <section className="content coach-schedule-workspace" id="coach-admin">
        <header className="coach-workspace-header">
          <div>
            <h1>관리자페이지</h1>
            <span className="coach-plan-badge">coach-db</span>
          </div>
        </header>

        <nav className="coach-detail-tabs coach-origin-tabs" aria-label="관리자페이지 탭">
          {TABS.map(({ tab, label }) => (
            <Link
              className={selectedTab === tab ? "selected" : ""}
              href={`/coaches/admin?tab=${tab}`}
              key={tab}
            >
              {label}
            </Link>
          ))}
        </nav>

        <AdminTabPanel selectedTab={selectedTab} />
      </section>
    </main>
  );
}

function AdminTabPanel({ selectedTab }: { selectedTab: CoachAdminTab }) {
  const panel = TABS.find(({ tab }) => tab === selectedTab);

  return (
    <section className="dashboard-panel coach-admin-placeholder">
      <div className="coach-doc-empty">
        <strong>{panel?.label} 구성 준비 중</strong>
        <span>이 섹션에 들어갈 내용을 곧 채울 예정입니다.</span>
      </div>
    </section>
  );
}
