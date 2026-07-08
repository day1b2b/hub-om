import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { UserManagement } from "./UserManagement";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireWorkspaceSession();
  const users = listTeamUsers();

  return (
    <main className="dashboard-shell">
      <AppSidebar label="사용자 관리" teamScope="both" />
      <section className="content operations-page">
        <header className="page-header">
          <div>
            <h1>사용자 관리</h1>
            <p className="page-subtitle">기업교육팀 구성원의 이름, 이메일, Slack ID를 관리합니다.</p>
          </div>
        </header>
        <UserManagement initialUsers={users} />
      </section>
    </main>
  );
}
