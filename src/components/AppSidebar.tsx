"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useIsAdmin } from "@/lib/auth/RoleContext";
import type { TeamScope } from "@/lib/teamScope";

interface AppSidebarProps {
  label?: string;
  teamScope: TeamScope;
}

export function AppSidebar({ label = "Operations", teamScope }: AppSidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = useIsAdmin();
  const displayName = session?.user?.name || session?.user?.email || "";
  void teamScope;
  void label;
  const isDatabaseAdminPage = pathname?.startsWith("/admin/database") ?? false;
  const isImportAdminPage = pathname?.startsWith("/admin/imports") ?? false;
  const isSyncAdminPage = pathname?.startsWith("/admin/sync") ?? false;
  const isUsersAdminPage = pathname?.startsWith("/admin/users") ?? false;
  const isSatisfactionPreviewPage = pathname?.startsWith("/admin/satisfaction-preview") ?? false;
  const isCourseNameRestorePage = pathname?.startsWith("/admin/course-name-restore") ?? false;
  const isMyDashboardPage = pathname === "/me";
  const isInstructorWikiPage = pathname === "/instructor-wiki";
  const isCompanyWikiPage = pathname === "/company-wiki";
  const isAnnouncementsPage = pathname?.startsWith("/announcements") ?? false;
  const isQuickLinksPage = pathname?.startsWith("/quick-links") ?? false;
  const isCreatePage = pathname === "/operations/new";
  const isOperationsPage = pathname === "/operations" || (pathname?.startsWith("/operations/") && !isCreatePage);
  const isCoachSchedulePage = pathname === "/coaches/schedule";
  const isCoachMyPage = pathname === "/coaches/my-page";
  const isCoachAdminPage = pathname === "/coaches/admin";
  const isCoachListPage =
    pathname === "/coaches" ||
    ((pathname?.startsWith("/coaches/") ?? false) && !isCoachSchedulePage && !isCoachMyPage && !isCoachAdminPage);
  const isResourcesPage = pathname === "/resources";
  const isOmManagePage = pathname?.startsWith("/om-request/manage") ?? false;
  const isOmRequestPage = !isOmManagePage && (pathname?.startsWith("/om-request") ?? false);

  return (
    <aside className="sidebar" aria-label="hub-om 메뉴">
      <Link className="brand" href="/dashboard">
        <div>
          <strong>Hello{displayName ? `, ${displayName}` : ""}!</strong>
        </div>
      </Link>
      {displayName ? (
        <button
          type="button"
          className="sidebar-signout"
          onClick={() => signOut({ redirectTo: "/sign-in" })}
        >
          로그아웃
        </button>
      ) : null}
      <nav className="nav-list">
        <div className="nav-section">
          <div className="nav-section-title">대시보드</div>
          <Link className={isMyDashboardPage ? "active" : ""} data-icon="👤" href="/me">내 대시보드</Link>
          <Link className={pathname === "/dashboard" ? "active" : ""} data-icon="📊" href="/dashboard">대시보드(전체)</Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">운영 요청</div>
          <Link className={isOmRequestPage ? "active" : ""} data-icon="📋" href="/om-request">업무 요청</Link>
          <Link className={isOmManagePage ? "active" : ""} data-icon="☑" href="/om-request/manage">담당 관리</Link>
          <Link className={isResourcesPage ? "active" : ""} data-icon="📁" href="/resources">과정 캘린더</Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">운영 현황</div>
          <Link className={isOperationsPage ? "active" : ""} data-icon="⭐" href="/operations">운영 현황</Link>
        </div>

        {isAdmin ? (
          <div className="nav-section nav-section-locked">
            <div className="nav-section-title">데이터 관리</div>
            <Link className={isSyncAdminPage ? "active" : ""} data-icon="🔒" href="/admin/sync">데이터 동기화</Link>
            <Link className={isSatisfactionPreviewPage ? "active" : ""} data-icon="🔒" href="/admin/satisfaction-preview">만족도 매칭</Link>
            <Link className={isImportAdminPage ? "active" : ""} data-icon="🔒" href="/admin/imports">데이터 일괄 등록</Link>
            <Link className={isUsersAdminPage ? "active" : ""} data-icon="🔒" href="/admin/users">멤버 관리</Link>
            <Link className={isDatabaseAdminPage ? "active" : ""} data-icon="🔒" href="/admin/database">DB 조회</Link>
            <Link className={isCourseNameRestorePage ? "active" : ""} data-icon="🔒" href="/admin/course-name-restore">과정명 되돌리기</Link>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="nav-section">
            <div className="nav-section-title">위키</div>
            <Link className={isCompanyWikiPage ? "active" : ""} data-icon="🔒" href="/company-wiki">기업 위키</Link>
            <Link className={isInstructorWikiPage ? "active" : ""} data-icon="🔒" href="/instructor-wiki">강사 위키</Link>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="nav-section">
            <div className="nav-section-title">코치</div>
            <Link className={isCoachSchedulePage ? "active" : ""} data-icon="🔒" href="/coaches/schedule">코치 일정</Link>
            <Link className={isCoachListPage ? "active" : ""} data-icon="🔒" href="/coaches">코치 목록</Link>
            <Link className={isCoachMyPage ? "active" : ""} data-icon="🔒" href="/coaches/my-page">마이페이지</Link>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="nav-section">
            <div className="nav-section-title">공지/운영TOOL</div>
            <Link className={isAnnouncementsPage ? "active" : ""} data-icon="🔒" href="/announcements">공지사항</Link>
            <Link className={isQuickLinksPage ? "active" : ""} data-icon="🔒" href="/quick-links">주요링크모음</Link>
          </div>
        ) : null}
      </nav>
    </aside>
  );
}
