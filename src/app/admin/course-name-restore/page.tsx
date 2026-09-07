import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { CourseNameRestorePanel } from "@/features/admin/CourseNameRestorePanel";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";

export const dynamic = "force-dynamic";

export default async function CourseNameRestorePage() {
  await requireAdminSession();

  return (
    <main className="dashboard-shell">
      <AppSidebar label="데이터 관리" teamScope="both" />

      <section className="content course-name-restore">
        <header className="page-header">
          <div>
            <p className="eyebrow">과정명 되돌리기</p>
            <h1>과정명 되돌리기</h1>
            <p className="lede">
              과정명을 잘못 바꿔 여러 과정이 한 과정으로 합쳐졌을 때, 회차별로 원래 과정명으로 되돌립니다.
              되돌릴 이름은 원천 적재 기록에서 그대로 가져오며, 조회만으로는 데이터가 바뀌지 않습니다.
            </p>
          </div>
          <Link className="primary-link" href="/operations">
            운영 현황
          </Link>
        </header>

        <CourseNameRestorePanel />
      </section>
    </main>
  );
}
