import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { OmRequestForm } from "./OmRequestForm";

export const dynamic = "force-dynamic";

export default async function OmRequestPage() {
  const session = await requireWorkspaceSession();
  const email = session.user?.email ?? "";

  // 요청자(LD)는 직접 입력이 아니라 멤버관리 레코드에서 자동으로 채운다(이메일 매칭).
  let memberName: string | undefined;
  try {
    const members = await listTeamUsers();
    const me = email
      ? members.find((m) => m.email.trim().toLowerCase() === email.trim().toLowerCase())
      : undefined;
    memberName = me?.name;
  } catch {
    memberName = undefined;
  }

  const ldName = memberName ?? session.user?.name ?? email.split("@")[0] ?? "";
  // 멤버관리에서 찾은 경우에만 잠금(자동 채움). 못 찾으면 직접 입력 허용.
  const ldLocked = Boolean(memberName);
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
        <OmRequestForm extraTools={extraTools} ldName={ldName} ldLocked={ldLocked} />
      </section>
    </main>
  );
}
