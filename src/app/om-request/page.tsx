import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { OmRequestForm } from "./OmRequestForm";

export const dynamic = "force-dynamic";

export default async function OmRequestPage() {
  const session = await requireWorkspaceSession();
  const ldName = session.user?.name ?? session.user?.email?.split("@")[0] ?? "";
  const extraTools = listCustomTools();

  const teamUsers = await listTeamUsers();
  const currentEmail = session.user?.email?.trim().toLowerCase();
  const matchedMember = currentEmail
    ? teamUsers.find((u) => u.email.trim().toLowerCase() === currentEmail)
    : undefined;

  // 기업명 콤보박스 추천용. 기존 운영 건에서 이미 쓰인 고객사명을 모아 자동완성 후보로 제공한다.
  // 목록에 없으면 자유 입력 그대로 신규 기업으로 접수된다(선택을 강제하지 않음).
  const operations = await getOperationRepository().listOperations();
  const knownCompanies = Array.from(new Set(operations.map((o) => o.companyName.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ko")
  );

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
        <OmRequestForm extraTools={extraTools} ldName={ldName} defaultTeam={matchedMember?.team} knownCompanies={knownCompanies} />
      </section>
    </main>
  );
}
