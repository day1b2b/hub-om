import { EggRentalBoard } from "@/features/eggs/EggRentalBoard";
import { requireSupplyPageSession } from "@/lib/auth/requireSupplySession";
import { isAdminEmail } from "@/lib/auth/requireAdminSession";
import { addDays, kstToday } from "@/lib/data/eggs/eggAvailability";
import { getEggRepository } from "@/lib/data/eggs/eggRepositoryFactory";
import { runEggRequest } from "@/lib/data/eggSupplyComposition";
import { parseEggPartQuery } from "@/lib/data/eggs/eggTypes";
import type {
  EggDeviceSummary,
  EggGuideContent,
  EggRentalRecord
} from "@/lib/data/eggs/eggTypes";

export const dynamic = "force-dynamic";

/** 지난 내역까지 전부 불러오면 무거워지므로 최근 90일 이후로 끝나는 대여만 읽는다 */
const HISTORY_WINDOW_DAYS = 90;

interface EggsPageProps {
  searchParams: Promise<{ part?: string; egg?: string }>;
}

export default async function EggsPage({ searchParams }: EggsPageProps) {
  const session = await requireSupplyPageSession();
  const isAdmin = isAdminEmail(session.user?.email);
  const today = kstToday();
  const query = await searchParams;

  let devices: EggDeviceSummary[] = [];
  let rentals: EggRentalRecord[] = [];
  let guides: EggGuideContent[] = [];
  let loadFailed = false;

  try {
    [devices, rentals, guides] = await runEggRequest(() => {
      const repository = getEggRepository();
      return Promise.all([
        repository.listDevices(),
        repository.listRentals({ fromDate: addDays(today, -HISTORY_WINDOW_DAYS) }),
        repository.listGuides()
      ]);
    });
  } catch (error) {
    console.error("[eggs] 에그 데이터를 불러오지 못했습니다.", error);
    loadFailed = true;
  }

  return (
    <EggRentalBoard
      devices={devices}
      rentals={rentals}
      guides={guides}
      today={today}
      initialPart={parseEggPartQuery(query.part)}
      initialDeviceId={query.egg ?? null}
      currentUserName={session.user?.name ?? ""}
      isAdmin={isAdmin}
      loadFailed={loadFailed}
    />
  );
}
