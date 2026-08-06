import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { UserManagement } from "./UserManagement";
import { InstructorMemberPanel } from "./InstructorMemberPanel";
import { PracticeCoachMemberPanel } from "./PracticeCoachMemberPanel";

export const dynamic = "force-dynamic";

type MemberTab = "ld-om" | "instructors" | "coaches";

const TABS: Array<{ tab: MemberTab; label: string }> = [
  { tab: "ld-om", label: "OM/LD" },
  { tab: "instructors", label: "강사" },
  { tab: "coaches", label: "실습코치" }
];

interface AdminUsersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  await requireWorkspaceSession();
  const params = await searchParams;
  const selectedTab = resolveTab(firstParam(params.tab));
  const users = selectedTab === "ld-om" ? await listTeamUsers() : [];

  return (
    <main className="dashboard-shell">
      <AppSidebar label="멤버 관리" teamScope="both" />
      <section className="content operations-page">
        <header className="page-header">
          <div>
            <h1>멤버 관리</h1>
            <p className="page-subtitle">OM, LD, 강사, 실습코치 멤버를 관리합니다.</p>
          </div>
        </header>

        <nav className="coach-detail-tabs coach-origin-tabs" aria-label="멤버 관리 탭">
          {TABS.map(({ tab, label }) => (
            <Link
              className={selectedTab === tab ? "selected" : ""}
              href={`/admin/users?tab=${tab}`}
              key={tab}
            >
              {label}
            </Link>
          ))}
        </nav>

        {selectedTab === "ld-om" && <UserManagement initialUsers={users} />}
        {selectedTab === "instructors" && <InstructorMemberPanel />}
        {selectedTab === "coaches" && <PracticeCoachMemberPanel />}
      </section>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveTab(value: string | undefined): MemberTab {
  if (value === "instructors" || value === "coaches") return value;
  return "ld-om";
}
