"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseTeamScope, TEAM_SCOPE_OPTIONS, type TeamScope } from "@/lib/teamScope";

interface AppSidebarProps {
  label?: string;
  teamScope: TeamScope;
}

export function AppSidebar({ label = "Operations", teamScope }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTeamScope = parseTeamScope(searchParams.get("team") ?? undefined) ?? teamScope;
  const isDatabaseAdminPage = pathname?.startsWith("/admin/database") ?? false;
  const isImportAdminPage = pathname?.startsWith("/admin/imports") ?? false;
  const isCreatePage = pathname === "/operations/new";
  const isOperationsPage = pathname === "/operations" || (pathname?.startsWith("/operations/") && !isCreatePage);
  const isCoachSchedulePage = pathname === "/coaches/schedule";
  const isCoachListPage =
    pathname === "/coaches" ||
    ((pathname?.startsWith("/coaches/") ?? false) && !isCoachSchedulePage);
  const isCoachResourcesPage = pathname?.startsWith("/resources/coaches") ?? false;
  const isResourcesPage = pathname === "/resources";

  return (
    <aside className="sidebar" aria-label="hub-om 메뉴">
      <div className="brand">
        <span className="brand-mark">OD</span>
        <div>
          <strong>hub-om</strong>
          <span>{label}</span>
        </div>
      </div>
      <nav className="nav-list">
        <div className="nav-section">
          <div className="nav-section-title">운영</div>
          <div className="sidebar-scope">
            <label htmlFor="team-scope">팀</label>
            <select id="team-scope" onChange={(event) => updateTeamScope(event.target.value as TeamScope)} value={currentTeamScope}>
              {TEAM_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Link className={pathname === "/dashboard" ? "active" : ""} data-icon="☆" href={hrefWithTeam("/dashboard")}>대시보드</Link>
          <Link className={isOperationsPage ? "active" : ""} data-icon="▤" href={hrefWithTeam("/operations")}>운영 현황</Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">코치</div>
          <Link className={isCoachSchedulePage ? "active" : ""} data-icon="◷" href="/coaches/schedule">코치 일정</Link>
          <Link className={isCoachResourcesPage ? "active" : ""} data-icon="◎" href="/resources/coaches">코치 리소스</Link>
          <Link className={isCoachListPage ? "active" : ""} data-icon="☰" href="/coaches">코치 목록</Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">리소스</div>
          <Link className={isResourcesPage ? "active" : ""} data-icon="◇" href="/resources">리소스</Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">관리</div>
          <Link className={isDatabaseAdminPage ? "active" : ""} data-icon="⚙" href="/admin/database">DB 조회</Link>
          <Link className={isImportAdminPage ? "active" : ""} data-icon="▥" href="/admin/imports">데이터 검수</Link>
        </div>
      </nav>
    </aside>
  );

  function updateTeamScope(nextTeamScope: TeamScope) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextTeamScope === "both") {
      params.delete("team");
    } else {
      params.set("team", nextTeamScope);
    }

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  }

  function hrefWithTeam(path: string) {
    return currentTeamScope === "both" ? path : `${path}?team=${currentTeamScope}`;
  }
}
