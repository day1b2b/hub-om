"use client";

import {
  getActiveRental,
  getDeviceAvailability,
  getNextRental,
  getOverdueRental
} from "@/lib/data/eggs/eggAvailability";
import { EGG_AVAILABILITY_CLASS, EGG_AVAILABILITY_LABEL } from "@/lib/data/eggs/eggTypes";
import type { EggDeviceSummary, EggRentalRecord } from "@/lib/data/eggs/eggTypes";
import { formatShortDate, getDeviceTraits, isDeviceInfoMissing } from "./eggDisplay";

interface EggDeviceGridProps {
  devices: EggDeviceSummary[];
  rentals: EggRentalRecord[];
  today: string;
  storageLocations: string[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}

/** 오늘 기준 에그 현황. 카드를 누르면 상세와 예약 폼이 열린다. */
export function EggDeviceGrid({
  devices,
  rentals,
  today,
  storageLocations,
  selectedDeviceId,
  onSelect
}: EggDeviceGridProps) {
  return (
    <section className="dashboard-panel">
      <div className="section-title">
        <h2 className="egg-storage">
          <span>보관 위치</span>
          {storageLocations.length > 0 ? storageLocations.join(" / ") : "미등록"}
        </h2>
        <span>{formatShortDate(today)} 기준 · 카드를 누르면 상세와 예약 창이 열립니다.</span>
      </div>
      <div className="egg-card-grid">
        {devices.map((device, index) => {
          const availability = getDeviceAvailability(device, rentals, today);
          const overdue = getOverdueRental(rentals, device.id, today);
          const active = getActiveRental(rentals, device.id, today);
          const next = getNextRental(rentals, device.id, today);
          const selected = device.id === selectedDeviceId;
          // "USB 1번"처럼 번호로 시작하지 않는 기기 묶음은 새 줄에서 시작해 일반 에그와 나눠 보이게 한다
          const startsNewGroup =
            index > 0 && isNumberedLabel(device.label) !== isNumberedLabel(devices[index - 1].label);

          return (
            <button
              type="button"
              key={device.id}
              className={`egg-card egg-card-${availability}${selected ? " egg-card-selected" : ""}${startsNewGroup ? " egg-card-row-start" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(device.id)}
            >
              <div className="egg-card-top">
                <strong>{device.label}</strong>
                <span className={EGG_AVAILABILITY_CLASS[availability]}>{EGG_AVAILABILITY_LABEL[availability]}</span>
              </div>

              <p className="egg-card-line">
                {overdue
                  ? `${formatShortDate(overdue.returnDueDate)} 반납 예정이었음 · ${overdue.borrowerName}`
                  : active
                    ? `${formatShortDate(active.returnDueDate)}까지 · ${active.borrowerName}`
                    : next
                      ? `다음 예약 ${formatShortDate(next.startDate)} · ${next.borrowerName}`
                      : "예정된 예약 없음"}
              </p>

              <div className="egg-traits">
                {getDeviceTraits(device).map((trait) => (
                  <span key={trait} className="egg-trait">
                    {trait}
                  </span>
                ))}
                {isDeviceInfoMissing(device) ? <span className="egg-trait egg-trait-warn">정보 미기재</span> : null}
              </div>
              {device.cautionNote ? <p className="egg-card-caution">{device.cautionNote}</p> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function isNumberedLabel(label: string): boolean {
  return /^\d/.test(label.trim());
}
