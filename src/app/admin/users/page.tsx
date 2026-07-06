import { AppSidebar } from "@/components/AppSidebar";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface AdminUsersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ROLE_LABEL: Record<string, string> = {
  om: "OM",
  ld: "LD"
};

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const session = await requireAdminSession();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [ownerRoster, params, members] = await Promise.all([
    teamMemberRepository.listResourceOwners(),
    searchParams,
    teamMemberRepository.listMembers()
  ]);
  const teamScope = resolveTeamScope(params, session, ownerRoster);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Admin" teamScope={teamScope} />

      <section className="content admin-users-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">관리자</p>
            <h1>사용자 관리</h1>
            <p className="lede">OM/LD 담당자 목록입니다. 현재는 조회만 가능합니다.</p>
          </div>
        </header>

        {members.length === 0 ? (
          <p className="admin-users-empty">등록된 사용자가 없습니다.</p>
        ) : (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>역할</th>
                  <th>팀</th>
                  <th>직함</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className={member.isActive ? "" : "row-inactive"}>
                    <td className="td-left">{member.name}</td>
                    <td>{member.role ? ROLE_LABEL[member.role] : "-"}</td>
                    <td>{member.sourceTeam ?? "-"}</td>
                    <td className="td-left">{member.roleTitle ?? "-"}</td>
                    <td>
                      <span className={`admin-users-status-badge ${member.isActive ? "active" : "inactive"}`}>
                        {member.isActive ? "활성" : "비활성"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
