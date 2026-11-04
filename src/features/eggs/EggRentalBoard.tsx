"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { getDeviceAvailability } from "@/lib/data/eggs/eggAvailability";
import { EGG_PART_LABEL, EGG_PART_QUERY, EGG_PARTS } from "@/lib/data/eggs/eggTypes";
import type {
  EggDeviceSummary,
  EggGuideContent,
  EggPart,
  EggRentalRecord
} from "@/lib/data/eggs/eggTypes";
import { callEggApi } from "./eggApi";
import { EggDeviceDetail } from "./EggDeviceDetail";
import { EggDeviceGrid } from "./EggDeviceGrid";
import { EggDevicePanel } from "./EggDevicePanel";
import { EggGuidePanel } from "./EggGuidePanel";
import { EggOpenRentals } from "./EggOpenRentals";
import { EggSearchSection, type EggReserveRequest } from "./EggSearchSection";
import { EggToast } from "./EggToast";

interface EggRentalBoardProps {
  devices: EggDeviceSummary[];
  rentals: EggRentalRecord[];
  guides: EggGuideContent[];
  today: string;
  initialPart: EggPart;
  initialDeviceId: string | null;
  currentUserName: string;
  isAdmin: boolean;
  loadFailed: boolean;
}

/** 탭·선택 에그를 주소에 남겨 슬랙 공유나 북마크로 바로 열 수 있게 한다 */
function syncUrl(part: EggPart, deviceId: string | null) {
  const params = new URLSearchParams();
  params.set("part", EGG_PART_QUERY[part]);
  if (deviceId) params.set("egg", deviceId);
  window.history.replaceState(null, "", `/eggs?${params.toString()}`);
}

export function EggRentalBoard({
  devices,
  rentals,
  guides,
  today,
  initialPart,
  initialDeviceId,
  currentUserName,
  isAdmin,
  loadFailed
}: EggRentalBoardProps) {
  const router = useRouter();
  const initialDevice = devices.find((device) => device.id === initialDeviceId);

  const [part, setPart] = useState<EggPart>(initialDevice?.part ?? initialPart);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(initialDevice?.id ?? null);
  const [reserveRange, setReserveRange] = useState<{ start: string; end: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const partDevices = useMemo(() => devices.filter((device) => device.part === part), [devices, part]);
  const partDeviceIds = useMemo(() => new Set(partDevices.map((device) => device.id)), [partDevices]);
  const partRentals = useMemo(
    () => rentals.filter((rental) => partDeviceIds.has(rental.eggDeviceId)),
    [rentals, partDeviceIds]
  );
  const guide = guides.find((item) => item.part === part) ?? null;
  const selectedDevice = partDevices.find((device) => device.id === selectedDeviceId) ?? null;
  const storageLocations = useMemo(
    () => Array.from(new Set(partDevices.map((device) => device.storageLocation).filter(Boolean))),
    [partDevices]
  );

  /** 대여자 자동완성: 기존 대여 기록에 나온 이름 */
  const borrowerNames = useMemo(
    () => Array.from(new Set(rentals.map((rental) => rental.borrowerName).filter(Boolean))).sort(),
    [rentals]
  );

  function countAvailable(target: EggPart): number {
    return devices.filter(
      (device) => device.part === target && getDeviceAvailability(device, rentals, today) === "available"
    ).length;
  }

  function resetFeedback() {
    setMessage(null);
    setError(null);
  }

  function changePart(next: EggPart) {
    resetFeedback();
    setPart(next);
    setSelectedDeviceId(null);
    setReserveRange(null);
    syncUrl(next, null);
  }

  function selectDevice(deviceId: string, range?: { start: string; end: string }) {
    resetFeedback();
    setSelectedDeviceId(deviceId);
    setReserveRange(range ?? null);
    syncUrl(part, deviceId);
  }

  function closeDetail() {
    setSelectedDeviceId(null);
    setReserveRange(null);
    syncUrl(part, null);
  }

  /** 예약이 끝나면 모달을 닫는다. 완료 문구는 토스트로 뜬다. */
  function handleReserved() {
    closeDetail();
  }

  function handleReserve(request: EggReserveRequest) {
    selectDevice(request.deviceId, { start: request.start, end: request.end });
  }

  /** 쓰기 요청 공통 처리: 진행 표시 → 결과 문구 → 화면 새로고침 */
  async function runAction(
    action: () => ReturnType<typeof callEggApi>,
    successMessage: string
  ): Promise<boolean> {
    resetFeedback();
    setPending(true);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "요청을 처리하지 못했습니다.");
      return false;
    }
    setMessage(successMessage);
    router.refresh();
    return true;
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label="에그 대여" teamScope="both" />
      <section className="content egg-page">
        <header className="page-header">
          <div>
            <h1>에그 대여</h1>
            <p className="page-subtitle">에그 현황을 확인하고, 일정에 맞는 에그를 예약합니다.</p>
          </div>
        </header>

        <div className="dashboard-tabs egg-part-tabs" role="group" aria-label="파트 선택">
          {EGG_PARTS.map((item) => {
            const total = devices.filter((device) => device.part === item).length;
            return (
              <button
                type="button"
                key={item}
                aria-pressed={part === item}
                className={part === item ? "selected" : ""}
                onClick={() => changePart(item)}
              >
                {EGG_PART_LABEL[item]} 에그
                <span className="egg-tab-count">
                  {countAvailable(item)}/{total}
                </span>
              </button>
            );
          })}
          <span className="egg-tab-hint">숫자는 오늘 사용 가능 / 전체 대수입니다.</span>
        </div>

        {loadFailed ? (
          <div className="dashboard-panel">
            <div className="empty-state">
              <strong>에그 정보를 불러오지 못했습니다.</strong>
              <span>잠시 후 다시 시도해주세요.</span>
            </div>
          </div>
        ) : (
          <>
            <EggToast message={message} onDone={() => setMessage(null)} />
            <div id="egg-feedback">
              {error ? <p className="egg-feedback egg-feedback-error" role="alert">{error}</p> : null}
            </div>

            {partDevices.length === 0 ? (
              <div className="dashboard-panel">
                <div className="empty-state">
                  <strong>{EGG_PART_LABEL[part]}에 등록된 에그가 없습니다.</strong>
                  <span>{isAdmin ? "아래 기기 관리에서 에그를 등록해주세요." : "관리자에게 등록을 요청해주세요."}</span>
                </div>
              </div>
            ) : (
              <>
                <EggDeviceGrid
                  devices={partDevices}
                  rentals={partRentals}
                  today={today}
                  storageLocations={storageLocations}
                  selectedDeviceId={selectedDeviceId}
                  onSelect={(deviceId) => selectDevice(deviceId)}
                />

                <EggGuidePanel key={`guide-${part}`} part={part} guide={guide} />

                <EggSearchSection
                  key={`search-${part}`}
                  devices={partDevices}
                  rentals={partRentals}
                  today={today}
                  onReserve={handleReserve}
                />

                {selectedDevice ? (
                  <EggDeviceDetail
                    key={`${selectedDevice.id}-${reserveRange?.start ?? ""}-${reserveRange?.end ?? ""}`}
                    device={selectedDevice}
                    rentals={partRentals}
                    today={today}
                    initialRange={reserveRange}
                    currentUserName={currentUserName}
                    borrowerNames={borrowerNames}
                    guideContent={guide?.content ?? ""}
                    pending={pending}
                    runAction={runAction}
                    error={error}
                    onReserved={handleReserved}
                    onClose={closeDetail}
                  />
                ) : null}

                <EggOpenRentals
                  devices={partDevices}
                  rentals={partRentals}
                  today={today}
                  pending={pending}
                  runAction={runAction}
                />
              </>
            )}

            {isAdmin ? <EggDevicePanel key={`devices-${part}`} part={part} devices={partDevices} /> : null}
          </>
        )}
      </section>
    </main>
  );
}

export type EggRunAction = (
  action: () => ReturnType<typeof callEggApi>,
  successMessage: string
) => Promise<boolean>;
