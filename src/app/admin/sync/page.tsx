import { AppSidebar } from "@/components/AppSidebar";
import { CoachSyncDashboard } from "@/features/admin/CoachSyncDashboard";
import { SalesRevenueSyncPanel } from "@/features/admin/SalesRevenueSyncPanel";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface AdminSyncPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminSyncPage({ searchParams }: AdminSyncPageProps) {
  const session = await requireAdminSession();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [ownerRoster, params] = await Promise.all([
    teamMemberRepository.listResourceOwners(),
    searchParams
  ]);
  const teamScope = resolveTeamScope(params, session, ownerRoster);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Admin" teamScope={teamScope} />

      <section className="content admin-sync-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">관리자 동기화</p>
            <h1>데이터 동기화</h1>
            <p className="lede">
              먼저 <strong>미리보기</strong>로 생성·수정·건너뜀 건수를 확인한 뒤, <strong>실제 반영</strong>으로 DB에 저장하세요.
              미리보기는 저장하지 않는 안전한 조회입니다.
            </p>
          </div>
        </header>

        <CoachSyncDashboard />

        <header className="page-header">
          <div>
            <p className="eyebrow">매출 동기화</p>
            <h2>세일즈맵 매출</h2>
            <p className="lede">
              코스ID로 매칭해 과정 매출 칸을 세일즈맵 금액으로 채웁니다. 새 과정이 생겼을 때 눌러 갱신하세요.
            </p>
          </div>
        </header>

        <SalesRevenueSyncPanel />
      </section>
    </main>
  );
}
