import { AppSidebar } from "@/components/AppSidebar";
import { AdminDatabaseGrid } from "@/features/admin/AdminDatabaseGrid";
import { DeletedOperationsPanel } from "@/features/admin/DeletedOperationsPanel";
import { OnsiteRequiredBackfillPanel } from "@/features/admin/OnsiteRequiredBackfillPanel";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import {
  readDatabaseDashboard,
  type DatabaseTableSnapshot
} from "@/lib/admin/databaseDashboard";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface AdminDatabasePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminDatabasePage({ searchParams }: AdminDatabasePageProps) {
  const session = await requireAdminSession();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [ownerRoster, params, snapshot] = await Promise.all([
    teamMemberRepository.listResourceOwners(),
    searchParams,
    readDatabaseDashboard()
  ]);
  const teamScope = resolveTeamScope(params, session, ownerRoster);
  const selectedTable = resolveSelectedTable(snapshot.tables, params.table);
  const columns = getColumns(selectedTable);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Admin" teamScope={teamScope} />

      <section className="content admin-database-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">관리자 DB</p>
            <h1>관리자 DB 대시보드</h1>
            <p className="lede">
              회색 셀은 읽기 전용이고, 수정 가능한 셀만 버튼으로 실제 DB에 저장할 수 있습니다.
            </p>
          </div>
          <div className="header-panel">
            <span>조회 시각</span>
            <strong>{formatDateTime(snapshot.generatedAt)}</strong>
          </div>
        </header>

        <AdminDatabaseGrid columns={columns} selectedTable={selectedTable} tables={snapshot.tables} teamScope={teamScope} />

        {selectedTable.key === "operation_sessions" ? (
          <>
            <OnsiteRequiredBackfillPanel />
            <DeletedOperationsPanel />
          </>
        ) : null}
      </section>
    </main>
  );
}

function getColumns(table: DatabaseTableSnapshot) {
  return Array.from(new Set(table.rows.flatMap((row) => row.cells.map((cell) => cell.label))));
}

function resolveSelectedTable(tables: DatabaseTableSnapshot[], value: string | string[] | undefined) {
  const tableKey = Array.isArray(value) ? value[0] : value;
  const requestedTable = tables.find((table) => table.key === tableKey);
  const defaultTable = tables.find((table) => table.key === "operation_sessions") ?? tables[0];

  return requestedTable ?? defaultTable;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}
