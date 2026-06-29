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
  const isCoachesPage = pathname?.startsWith("/coaches") ?? false;
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
      <nav className="nav-list">
        <Link className={pathname === "/dashboard" ? "active" : ""} href={hrefWithTeam("/dashboard")}>대시보드</Link>
        <Link className={isOperationsPage ? "active" : ""} href={hrefWithTeam("/operations")}>운영 현황</Link>
        <Link className={isCoachesPage ? "active" : ""} href={hrefWithTeam("/coaches/schedule")}>코치 일정</Link>
        <Link className={isResourcesPage ? "active" : ""} href={hrefWithTeam("/resources")}>리소스</Link>
        <Link className={isCoachResourcesPage ? "active" : ""} href={hrefWithTeam("/resources/coaches")}>코치 리소스</Link>
        <Link className={isDatabaseAdminPage ? "active" : ""} href={hrefWithTeam("/admin/database")}>DB 조회</Link>
        <Link className={isImportAdminPage ? "active" : ""} href="/admin/imports">데이터 검수</Link>
      </nav>
      <Link className={`sidebar-action${isCreatePage ? " active" : ""}`} href={hrefWithTeam("/operations/new")}>+ 과정 작성</Link>
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
