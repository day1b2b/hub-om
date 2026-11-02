"use client";

import { useMemo } from "react";
import type { EggDeviceSummary, EggRentalRecord } from "@/lib/data/eggs/eggTypes";
import { formatRange } from "./eggDisplay";
import type { EggRunAction } from "./EggRentalBoard";
import { EggRentalActionButton, getRentalStateLabel } from "./EggRentalActionButton";

interface EggOpenRentalsProps {
  devices: EggDeviceSummary[];
  rentals: EggRentalRecord[];
  today: string;
  pending: boolean;
  runAction: EggRunAction;
}

/** 파트 안 미반납(대여 중·반납 지연·대여 예정) 전체. 반납 지연을 맨 위에 둔다. */
export function EggOpenRentals({ devices, rentals, today, pending, runAction }: EggOpenRentalsProps) {
  const openRentals = useMemo(
    () =>
      rentals
        .filter((rental) => !rental.returned)
        .sort((a, b) => {
          const aOverdue = a.returnDueDate < today ? 0 : 1;
          const bOverdue = b.returnDueDate < today ? 0 : 1;
          return aOverdue - bOverdue || a.startDate.localeCompare(b.startDate);
        }),
    [rentals, today]
  );
  const overdueCount = openRentals.filter((rental) => rental.returnDueDate < today).length;

  function deviceLabel(deviceId: string): string {
    return devices.find((device) => device.id === deviceId)?.label ?? "알 수 없는 에그";
  }

  return (
    <section className="dashboard-panel">
      <div className="section-title">
        <h2>미반납 현황</h2>
        <span>
          {openRentals.length}건{overdueCount > 0 ? ` · 반납 지연 ${overdueCount}건` : ""}
        </span>
      </div>
      {openRentals.length === 0 ? (
        <div className="empty-state">
          <strong>미반납 건이 없습니다.</strong>
          <span>예약이 등록되면 여기에 표시됩니다.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="egg-table">
            <thead>
              <tr>
                <th>에그</th>
                <th>기간</th>
                <th>대여자</th>
                <th>과정명</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {openRentals.map((rental) => {
                const state = getRentalStateLabel(rental, today);
                const label = deviceLabel(rental.eggDeviceId);
                return (
                  <tr key={rental.id} className={`egg-row-${state.tone}`}>
                    <td>
                      <strong>{label}</strong>
                    </td>
                    <td>{formatRange(rental.startDate, rental.returnDueDate)}</td>
                    <td>{rental.borrowerName}</td>
                    <td>
                      {rental.courseName}
                      {rental.note ? <span>{rental.note}</span> : null}
                    </td>
                    <td>
                      <span className={state.className}>{state.label}</span>
                    </td>
                    <td>
                      <EggRentalActionButton
                        rental={rental}
                        deviceLabel={label}
                        today={today}
                        pending={pending}
                        runAction={runAction}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
