import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { ActivityPanel } from "@/app/admin/activity/ActivityPanel";
import styles from "./activity.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "활동 기록 | hub-om",
  robots: { index: false, follow: false }
};

/** Same-origin Google session; never depends on Sites authentication or a browser feed key. */
export default async function ActivityPage() {
  const session = await requireAdminSession();
  return <main className={styles.shell}>
    <header className={styles.header}>
      <Link href="/dashboard" className={styles.brand}>hub-om</Link>
      <span>활동 기록 · 관리자 전용</span>
      <Link href="/dashboard">업무 화면으로 돌아가기</Link>
    </header>
    <section className={styles.content} aria-labelledby="activity-title">
      <div className={styles.heading}>
        <div><h1 id="activity-title">활동 기록</h1><p>누가 이용하고, 무엇을 변경했는지 확인하세요. 날짜와 시각은 한국 시간 기준입니다.</p></div>
        <span className={styles.account}>{session.user?.email}</span>
      </div>
      <ActivityPanel />
    </section>
  </main>;
}
