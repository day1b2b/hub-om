import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { CoachSyncDashboard } from "@/features/admin/CoachSyncDashboard";
import { ContentManagementPanel } from "./ContentManagementPanel";
import { DeletedCoachesPanel } from "./DeletedCoachesPanel";
import { ScheduleLinkPanel } from "./ScheduleLinkPanel";

export type CoachAdminTab = "schedule-link" | "deleted" | "sync" | "content";

interface CoachAdminPageProps {
  selectedTab: CoachAdminTab;
  deletedCount: number;
}

export function CoachAdminPage({ selectedTab, deletedCount }: CoachAdminPageProps) {
  const TABS: Array<{ tab: CoachAdminTab; label: string }> = [
    { tab: "schedule-link", label: "일정 등록 링크" },
    { tab: "deleted", label: `삭제 내역 (${deletedCount})` },
    { tab: "sync", label: "동기화" },
    { tab: "content", label: "콘텐츠 관리" }
  ];

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
  if (selectedTab === "schedule-link") {
    return (
      <section className="dashboard-panel">
        <ScheduleLinkPanel />
      </section>
    );
  }

  if (selectedTab === "deleted") {
    return (
      <section className="dashboard-panel">
        <DeletedCoachesPanel />
      </section>
    );
  }

  if (selectedTab === "sync") {
    return (
      <section className="dashboard-panel">
        <CoachSyncDashboard sourceIds={["notion", "engagements"]} />
      </section>
    );
  }

  return (
    <section className="dashboard-panel">
      <ContentManagementPanel />
    </section>
  );
}
