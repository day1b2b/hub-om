import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listOmRequests } from "@/lib/data/omRequest/omRequestLocalRepository";
import { OmRequestTable } from "./OmRequestTable";

export const dynamic = "force-dynamic";

export default async function OmRequestManagePage() {
  await requireWorkspaceSession();
  const requests = listOmRequests().sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <main className="dashboard-shell">
      <AppSidebar label="담당 관리" teamScope="both" />
      <section className="content operations-page">
        <header className="page-header">
          <div>
            <h1>담당 관리</h1>
            <p className="page-subtitle">접수된 OM 배정 요청을 확인하고 담당자를 배정합니다.</p>
          </div>
        </header>
        <OmRequestTable initialRequests={requests} />
      </section>
    </main>
  );
}
