import Link from "next/link";
import { OperationCreateForm } from "@/app/operations/new/OperationCreateForm";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function NewOperationPage() {
  await requireWorkspaceSession();
  const teamMemberRepository = getTeamMemberRepository();
  const ownerRoster = await teamMemberRepository.listResourceOwners();
  const today = formatDate(new Date());
  const nameOptions = unique(Object.values(ownerRoster).flatMap((owners) => owners ?? []));

  return (
    <main className="dashboard-shell">
      <aside className="sidebar" aria-label="hub-om 메뉴">
        <div className="brand">
          <span className="brand-mark">OD</span>
          <div>
            <strong>hub-om</strong>
            <span>Operations</span>
          </div>
        </div>
        <nav className="nav-list">
          <Link href="/">대시보드</Link>
          <Link className="active" href="/operations">운영 현황</Link>
          <Link href="/resources">리소스</Link>
        </nav>
      </aside>

      <section className="content operations-page operation-create-page">
        <header className="page-header operation-create-header">
          <div>
            <Link className="back-link" href="/operations">← 운영 현황</Link>
            <h1>과정 작성</h1>
          </div>
          <div className="header-panel">
            <span>저장 위치</span>
            <strong>운영 DB</strong>
          </div>
        </header>

        <OperationCreateForm nameOptions={nameOptions} today={today} />
      </section>
    </main>
  );
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
