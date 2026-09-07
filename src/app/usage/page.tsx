import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { ActivityPageShell } from "@/features/activity/ActivityPageShell";
import { UsagePanel } from "@/features/activity/UsagePanel";
import { koreaDate } from "@/lib/activity/usage";
export const dynamic = "force-dynamic";
export const metadata = { title: "오늘의 이용 현황 | hub-om", robots: { index: false, follow: false } };
export default async function UsagePage() {
  await requireAdminSession();
  return <ActivityPageShell title="오늘의 이용 현황" description="누가 서비스를 이용했는지 확인합니다. 자동 작업은 사용자 이용과 따로 집계합니다."><UsagePanel today={koreaDate()} /></ActivityPageShell>;
}
