import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { OmRequestForm } from "./OmRequestForm";

export const dynamic = "force-dynamic";

export default async function OmRequestPage() {
  const session = await requireWorkspaceSession();
  const ldName = session.user?.name ?? session.user?.email?.split("@")[0] ?? "";
  const extraTools = listCustomTools();

  return (
    <main className="dashboard-shell">
      <AppSidebar label="업무 요청" teamScope="both" />
      <section className="content operations-page operation-create-page">
        <header className="page-header operation-create-header">
          <div>
            <h1>OM 업무 요청</h1>
            <p className="page-subtitle">교육 운영 담당자(OM) 업무를 요청합니다.</p>
          </div>
        </header>
        <OmRequestForm extraTools={extraTools} ldName={ldName} />
      </section>
    </main>
  );
}
