import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { ActivityPageShell } from "@/features/activity/ActivityPageShell";

import { ChangesWorkspace } from "@/features/activity/ChangesWorkspace";
export const dynamic = "force-dynamic";
export const metadata = { title: "전체 변경 이력 | hub-om", robots: { index: false, follow: false } };
export default async function ChangesPage() {
  await requireAdminSession();
  return <ActivityPageShell title="전체 변경 이력" description="운영 회차·코치·공지 등 전체 업무의 데이터 변경을 확인합니다."><ChangesWorkspace /></ActivityPageShell>;
}
