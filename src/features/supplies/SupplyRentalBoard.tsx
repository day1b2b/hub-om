"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { callEggApi } from "@/features/eggs/eggApi";
import { formatRange, formatShortDate } from "@/features/eggs/eggDisplay";
import { getRentalStateLabel } from "@/features/eggs/EggRentalActionButton";
import { EggToast } from "@/features/eggs/EggToast";
import { isValidDate } from "@/lib/data/eggs/eggAvailability";
import {
  getActiveSupplyRental,
  getNextSupplyRental,
  getOverdueSupplyRental,
  getSupplyAvailability,
  getSupplyConflicts
} from "@/lib/data/supplies/supplyAvailability";
import {
  SUPPLY_AVAILABILITY_CLASS,
  SUPPLY_AVAILABILITY_LABEL,
  SUPPLY_CATEGORY_LABEL
} from "@/lib/data/supplies/supplyTypes";
import type {
  SupplyCategory,
  SupplyItemSummary,
  SupplyRentalRecord
} from "@/lib/data/supplies/supplyTypes";

interface SupplyRentalBoardProps {
  category: SupplyCategory;
  items: SupplyItemSummary[];
  rentals: SupplyRentalRecord[];
  today: string;
  currentUserName: string;
  loadFailed: boolean;
}

/**
 * 운영물품 대여 화면(마이크 등). 물품 수가 적어 에그처럼 기간 조회를 따로 두지 않고,
 * 예약 폼에서 날짜를 고르는 즉시 겹치는 예약을 보여준다.
 */
export function SupplyRentalBoard({
  category,
  items,
  rentals,
  today,
  currentUserName,
  loadFailed
}: SupplyRentalBoardProps) {
  const router = useRouter();
  const title = `${SUPPLY_CATEGORY_LABEL[category]} 대여`;

  const [selectedIds, setSelectedIds] = useState<string[]>(() => items.map((item) => item.id));
  const [borrowerName, setBorrowerName] = useState(currentUserName);
  const [courseName, setCourseName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [returnDueDate, setReturnDueDate] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const storageLocations = Array.from(new Set(items.map((item) => item.storageLocation).filter(Boolean)));

  const conflicts = useMemo(() => {
    if (!isValidDate(startDate) || !isValidDate(returnDueDate) || returnDueDate < startDate) return [];
    return getSupplyConflicts(rentals, selectedIds, startDate, returnDueDate);
  }, [rentals, selectedIds, startDate, returnDueDate]);

  /** 미반납 건을 먼저(반납 지연 → 시작일 순), 그 뒤에 최근 1주일 반납 건 */
  const listedRentals = useMemo(
    () =>
      [...rentals].sort((a, b) => {
        const rank = (rental: SupplyRentalRecord) =>
          rental.returned ? 2 : rental.returnDueDate < today ? 0 : 1;
        return rank(a) - rank(b) || a.startDate.localeCompare(b.startDate);
      }),
    [rentals, today]
  );

  function itemLabels(itemIds: string[]): string {
    return items
      .filter((item) => itemIds.includes(item.id))
      .map((item) => item.label)
      .join(", ");
  }

  function toggleItem(itemId: string) {
    setSelectedIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
    );
  }

  async function runAction(action: () => ReturnType<typeof callEggApi>, successMessage: string): Promise<boolean> {
    setMessage(null);
    setError(null);
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

  async function submit() {
    setError(null);
    if (selectedIds.length === 0) {
      setError("빌릴 물품을 하나 이상 골라주세요.");
      return;
    }
    if (!borrowerName.trim() || !courseName.trim()) {
      setError("대여자와 과정명을 입력해주세요.");
      return;
    }
    if (!isValidDate(startDate) || !isValidDate(returnDueDate)) {
      setError("대여 시작일과 반납 예정일을 선택해주세요.");
      return;
    }
    if (returnDueDate < startDate) {
      setError("반납 예정일이 대여 시작일보다 앞설 수 없습니다.");
      return;
    }
    if (conflicts.length > 0) return;

    const ok = await runAction(
      () =>
        callEggApi("/api/supplies/rentals", "POST", {
          category,
          itemIds: selectedIds,
          borrowerName: borrowerName.trim(),
          courseName: courseName.trim(),
          startDate,
          returnDueDate,
          note: note.trim()
        }),
      `${itemLabels(selectedIds)} 예약을 등록했습니다. (${formatRange(startDate, returnDueDate)})`
    );
    if (ok) {
      setCourseName("");
      setStartDate("");
      setReturnDueDate("");
      setNote("");
    }
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label={title} teamScope="both" />
      <section className="content egg-page">
        <header className="page-header">
          <div>
            <h1>{title}</h1>
            <p className="page-subtitle">오늘 현황을 보고, 쓸 날짜에 비어 있으면 바로 예약합니다.</p>
          </div>
        </header>

        {loadFailed ? (
          <div className="dashboard-panel">
            <div className="empty-state">
              <strong>{title} 정보를 불러오지 못했습니다.</strong>
              <span>잠시 후 다시 시도해주세요.</span>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="dashboard-panel">
            <div className="empty-state">
              <strong>등록된 물품이 없습니다.</strong>
              <span>관리자에게 등록을 요청해주세요.</span>
            </div>
          </div>
        ) : (
          <>
            <EggToast message={message} onDone={() => setMessage(null)} />
            {error ? <p className="egg-feedback egg-feedback-error" role="alert">{error}</p> : null}

            <section className="dashboard-panel">
              <div className="section-title">
                <h2 className="egg-storage">
                  <span>보관 위치</span>
                  {storageLocations.length > 0 ? storageLocations.join(" / ") : "미등록"}
                </h2>
                <span>{formatShortDate(today)} 기준</span>
              </div>
              <div className="egg-card-grid">
                {items.map((item) => {
                  const availability = getSupplyAvailability(rentals, item.id, today);
                  const overdue = getOverdueSupplyRental(rentals, item.id, today);
                  const active = getActiveSupplyRental(rentals, item.id, today);
                  const next = getNextSupplyRental(rentals, item.id, today);
                  return (
                    <div key={item.id} className={`egg-card egg-card-${availability}`}>
                      <div className="egg-card-top">
                        <strong>{item.label}</strong>
                        <span className={SUPPLY_AVAILABILITY_CLASS[availability]}>
                          {SUPPLY_AVAILABILITY_LABEL[availability]}
                        </span>
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
                      {item.components ? (
                        <div className="egg-traits">
                          <span className="egg-trait">{item.components}</span>
                        </div>
                      ) : null}
                      {item.note ? <p className="egg-card-caution">{item.note}</p> : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="dashboard-panel">
              <div className="section-title">
                <h2>예약하기</h2>
                <span>날짜를 고르면 겹치는 예약이 바로 보입니다.</span>
              </div>
              <div className="egg-detail-body">
                <fieldset className="supply-item-picker">
                  <legend>
                    빌릴 물품 <span className="required-mark">*</span>
                  </legend>
                  {items.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleItem(item.id)}
                      />
                      <span>
                        {item.label}
                        {item.components ? <small>{item.components}</small> : null}
                      </span>
                    </label>
                  ))}
                </fieldset>

                <div className="egg-form-grid">
                  <label>
                    <span>
                      대여자 <span className="required-mark">*</span>
                    </span>
                    <input
                      type="text"
                      value={borrowerName}
                      onChange={(event) => setBorrowerName(event.target.value)}
                      placeholder="이름"
                    />
                  </label>
                  <label>
                    <span>
                      과정명 <span className="required-mark">*</span>
                    </span>
                    <input
                      type="text"
                      value={courseName}
                      onChange={(event) => setCourseName(event.target.value)}
                      placeholder="기업명_과정명"
                    />
                  </label>
                  <label>
                    <span>
                      대여 시작일 <span className="required-mark">*</span>
                    </span>
                    <input
                      type="date"
                      value={startDate}
                      min={today}
                      onChange={(event) => setStartDate(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>
                      반납 예정일 <span className="required-mark">*</span>
                    </span>
                    <input
                      type="date"
                      value={returnDueDate}
                      min={startDate || today}
                      onChange={(event) => setReturnDueDate(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>비고</span>
                    <input
                      type="text"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="강의장, 사용 인원 등"
                    />
                  </label>
                </div>

                {conflicts.length > 0 ? (
                  <div className="egg-note egg-note-danger" role="alert">
                    <strong>이 기간에는 이미 예약이 있습니다.</strong>
                    <ul>
                      {conflicts.map((rental) => (
                        <li key={rental.id}>
                          {itemLabels(rental.itemIds)} · {formatRange(rental.startDate, rental.returnDueDate)} ·{" "}
                          {rental.borrowerName} · {rental.courseName}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="egg-actions">
                  <button
                    type="button"
                    className="assign-save-btn"
                    disabled={pending || conflicts.length > 0}
                    onClick={submit}
                  >
                    {pending ? "처리 중..." : "예약하기"}
                  </button>
                </div>
              </div>
            </section>

            <section className="dashboard-panel">
              <div className="section-title">
                <h2>대여 현황</h2>
                <span>미반납 전체 · 반납 완료는 최근 1주일</span>
              </div>
              {listedRentals.length === 0 ? (
                <div className="empty-state">
                  <strong>대여 기록이 없습니다.</strong>
                  <span>예약이 등록되면 여기에 표시됩니다.</span>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="egg-table">
                    <thead>
                      <tr>
                        <th>물품</th>
                        <th>기간</th>
                        <th>대여자</th>
                        <th>과정명</th>
                        <th>상태</th>
                        <th>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listedRentals.map((rental) => {
                        const state = getRentalStateLabel(rental, today);
                        const labels = itemLabels(rental.itemIds);
                        const summary = `${labels} · ${formatRange(rental.startDate, rental.returnDueDate)} · ${rental.borrowerName}`;
                        return (
                          <tr key={rental.id} className={`egg-row-${state.tone}`}>
                            <td>
                              <strong>{labels}</strong>
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
                              {rental.returned ? (
                                <span className="egg-muted-text">-</span>
                              ) : rental.startDate > today ? (
                                <button
                                  type="button"
                                  className="assign-cancel-btn"
                                  disabled={pending}
                                  onClick={() => {
                                    if (!window.confirm(`이 예약을 취소할까요?\n${summary}`)) return;
                                    void runAction(
                                      () => callEggApi(`/api/supplies/rentals/${rental.id}`, "DELETE"),
                                      "예약을 취소했습니다."
                                    );
                                  }}
                                >
                                  예약 취소
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="assign-save-btn"
                                  disabled={pending}
                                  onClick={() => {
                                    if (!window.confirm(`반납 처리할까요?\n${summary}`)) return;
                                    void runAction(
                                      () => callEggApi(`/api/supplies/rentals/${rental.id}`, "PATCH"),
                                      "반납 처리했습니다."
                                    );
                                  }}
                                >
                                  반납 처리
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
