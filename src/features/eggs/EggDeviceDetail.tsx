"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getConflicts,
  getDeviceAvailability,
  getVisibleRentals,
  isDataExhaustedNow,
  isValidDate,
  kstToday
} from "@/lib/data/eggs/eggAvailability";
import {
  EGG_AVAILABILITY_CLASS,
  EGG_AVAILABILITY_LABEL,
  EGG_CHARGER_LABEL,
  EGG_PART_LABEL
} from "@/lib/data/eggs/eggTypes";
import type { EggDeviceSummary, EggRentalRecord } from "@/lib/data/eggs/eggTypes";
import { callEggApi } from "./eggApi";
import { formatRange, isDeviceInfoMissing } from "./eggDisplay";
import { EggGuideText } from "./EggGuidePanel";
import type { EggRunAction } from "./EggRentalBoard";
import { EggRentalActionButton, getRentalStateLabel } from "./EggRentalActionButton";

interface EggDeviceDetailProps {
  device: EggDeviceSummary;
  rentals: EggRentalRecord[];
  today: string;
  initialRange: { start: string; end: string } | null;
  currentUserName: string;
  borrowerNames: string[];
  guideContent: string;
  pending: boolean;
  runAction: EggRunAction;
  /** 실패 문구는 모달 안에서 바로 보여준다. 완료 문구는 화면 위 토스트로 뜬다. */
  error: string | null;
  onReserved: () => void;
  onClose: () => void;
}

const EXHAUST_TOOLTIP = "소진으로 표시하면 다음 달 1일에 자동으로 해제됩니다.";

export function EggDeviceDetail({
  device,
  rentals,
  today,
  initialRange,
  currentUserName,
  borrowerNames,
  guideContent,
  pending,
  runAction,
  error,
  onReserved,
  onClose
}: EggDeviceDetailProps) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc로 닫고, 모달이 떠 있는 동안 뒤 페이지가 스크롤되지 않게 막는다
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const [borrowerName, setBorrowerName] = useState(currentUserName);
  const [courseName, setCourseName] = useState("");
  const [startDate, setStartDate] = useState(initialRange?.start ?? "");
  const [returnDueDate, setReturnDueDate] = useState(initialRange?.end ?? "");
  const [actualUseNote, setActualUseNote] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const exhausted = isDataExhaustedNow(device, today);
  const visibleRentals = useMemo(() => getVisibleRentals(rentals, device.id, today), [rentals, device.id, today]);

  /** 입력 중인 기간과 겹치는 예약을 바로 보여주고, 겹치면 제출을 막는다 */
  const formConflicts = useMemo(() => {
    if (!isValidDate(startDate) || !isValidDate(returnDueDate) || returnDueDate < startDate) return [];
    return getConflicts(rentals, device.id, startDate, returnDueDate);
  }, [rentals, device.id, startDate, returnDueDate]);

  async function submit() {
    setFormError(null);
    if (!borrowerName.trim() || !courseName.trim()) {
      setFormError("대여자와 과정명을 입력해주세요.");
      return;
    }
    if (!isValidDate(startDate) || !isValidDate(returnDueDate)) {
      setFormError("대여 시작일과 반납 예정일을 선택해주세요.");
      return;
    }
    if (returnDueDate < startDate) {
      setFormError("반납 예정일이 대여 시작일보다 앞설 수 없습니다.");
      return;
    }
    if (formConflicts.length > 0) return;

    const ok = await runAction(
      () =>
        callEggApi("/api/eggs/rentals", "POST", {
          eggDeviceId: device.id,
          borrowerName: borrowerName.trim(),
          courseName: courseName.trim(),
          startDate,
          returnDueDate,
          actualUseNote: actualUseNote.trim(),
          note: note.trim()
        }),
      `${device.label} 예약을 등록했습니다. (${formatRange(startDate, returnDueDate)})`
    );
    if (ok) onReserved();
  }

  function toggleExhausted() {
    const next = !exhausted;
    void runAction(
      () =>
        callEggApi(`/api/eggs/devices/${device.id}`, "PATCH", {
          action: "exhaust",
          exhausted: next
        }),
      next
        ? `${device.label}을(를) 데이터 소진으로 표시했습니다.`
        : `${device.label}의 데이터 소진 표시를 해제했습니다.`
    );
  }

  const infoMissing = isDeviceInfoMissing(device);
  const availability = getDeviceAvailability(device, rentals, today);

  // 입력 중인 내용이 날아가지 않도록 바깥 영역 클릭으로는 닫지 않는다
  return (
    <div aria-modal="true" className="drive-review-modal" role="dialog">
      <div className="drive-review-backdrop" />
      <section aria-labelledby="egg-detail-title" className="drive-review-dialog egg-detail-modal">
        <div className="drive-review-header">
          <div className="egg-detail-head">
            <span className={EGG_AVAILABILITY_CLASS[availability]}>
              {EGG_AVAILABILITY_LABEL[availability]}
              {exhausted ? <span className="egg-modal-status-note">다음 달 1일 충전</span> : null}
            </span>
            <div className="egg-modal-title-row">
              <h2 id="egg-detail-title" className="egg-modal-title">
                <span className="egg-modal-part">{EGG_PART_LABEL[device.part]}</span>
                {device.label} 에그
              </h2>
              <div className="egg-exhaust-control">
                <span className="egg-exhaust-button-wrap">
                  <button
                    type="button"
                    className={exhausted ? "egg-exhaust-button egg-exhaust-on" : "egg-exhaust-button"}
                    disabled={pending}
                    onClick={toggleExhausted}
                  >
                    {exhausted ? "소진 표시 해제" : "데이터 소진 표시"}
                  </button>
                  <span
                    className="egg-info-tip"
                    tabIndex={0}
                    role="img"
                    aria-label={EXHAUST_TOOLTIP}
                    data-tooltip={EXHAUST_TOOLTIP}
                  >
                    i
                  </span>
                </span>
                {exhausted ? <small>{formatExhaustedBy(device)}</small> : null}
              </div>
            </div>
            {initialRange ? (
              <p>{`${formatRange(initialRange.start, initialRange.end)} 예약 내용을 입력해주세요.`}</p>
            ) : null}
          </div>
          <button aria-label="에그 상세 닫기" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="egg-detail-body">
          {error ? (
            <p className="egg-feedback egg-feedback-error" role="alert">
              {error}
            </p>
          ) : null}
          <dl className="egg-info">
            <InfoItem label="WiFi 이름" value={device.wifiName} />
            <InfoItem label="WiFi 비밀번호" value={device.wifiPassword} mono />
            <InfoItem label="일련번호" value={device.serialNumber} mono />
            <InfoItem label="기기번호(L코드)" value={device.modelCode ?? ""} mono />
            <InfoItem
              label="충전 단자"
              value={device.chargerType === "UNKNOWN" ? "" : EGG_CHARGER_LABEL[device.chargerType]}
            />
            <InfoItem label="속도" value={device.speedMbps ? `${device.speedMbps}Mbps` : ""} />
            <InfoItem label="월 데이터" value={device.monthlyDataGb ? `${device.monthlyDataGb}GB` : ""} />
            <InfoItem label="보관 위치" value={device.storageLocation} />
            <InfoItem label="렌탈 만료일" value={device.contractEndsOn ?? ""} />
          </dl>
          {infoMissing ? (
            <p className="egg-note egg-note-warn">관리대장에 WiFi 이름·일련번호가 아직 적혀 있지 않은 에그입니다.</p>
          ) : null}
          {device.cautionNote ? <p className="egg-note">{device.cautionNote}</p> : null}

          <div className="egg-form">
            <h3>이 에그 예약하기</h3>
            <div className="egg-form-grid">
              <label>
                <span>
                  대여자 <span className="required-mark">*</span>
                </span>
                <input
                  type="text"
                  list="egg-borrower-list"
                  value={borrowerName}
                  onChange={(event) => setBorrowerName(event.target.value)}
                  placeholder="이름"
                />
                <datalist id="egg-borrower-list">
                  {borrowerNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>
                  과정명 <span className="required-mark">*</span>
                </span>
                <input
                  type="text"
                  value={courseName}
                  autoFocus={Boolean(initialRange)}
                  onChange={(event) => setCourseName(event.target.value)}
                  placeholder="기업명_과정명"
                />
              </label>
              <label>
                <span>비고</span>
                <input
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="강사용, 예비용, OM용, 수강생용 등"
                />
              </label>
              <label>
                <span>
                  대여 시작일 <span className="required-mark">*</span>
                </span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label>
                <span>
                  반납 예정일 <span className="required-mark">*</span>
                </span>
                <input
                  type="date"
                  value={returnDueDate}
                  min={startDate || undefined}
                  onChange={(event) => setReturnDueDate(event.target.value)}
                />
              </label>
              <label>
                <span>실제 사용일</span>
                <input
                  type="text"
                  value={actualUseNote}
                  onChange={(event) => setActualUseNote(event.target.value)}
                  placeholder="예: 10/29 ~ 10/30"
                />
              </label>
            </div>

            {formConflicts.length > 0 ? (
              <div className="egg-note egg-note-danger" role="alert">
                <strong>이 기간에는 이미 예약이 있습니다.</strong>
                <ul>
                  {formConflicts.map((rental) => (
                    <li key={rental.id}>
                      {formatRange(rental.startDate, rental.returnDueDate)} · {rental.borrowerName} ·{" "}
                      {rental.courseName}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {formError ? <p className="egg-inline-error">{formError}</p> : null}

            {guideContent.trim() ? (
              <div className="egg-form-guide">
                <strong className="egg-form-guide-title">예약 전에 확인해주세요</strong>
                <EggGuideText content={guideContent} />
              </div>
            ) : null}

            <div className="egg-actions">
              <button
                type="button"
                className="assign-save-btn"
                disabled={pending || formConflicts.length > 0}
                onClick={submit}
              >
                {pending ? "처리 중..." : "예약하기"}
              </button>
            </div>

            {exhausted ? (
              <p className="egg-note egg-exhausted-alert">
                이번 달 데이터가 소진된 에그입니다. 사용 전 잔량을 꼭 확인해주세요.
              </p>
            ) : null}
          </div>

          <div className="egg-history">
            <h3>최근 대여 내역</h3>
            <p className="field-hint">지난 대여는 가장 최근 1건만 보여줍니다.</p>
            {visibleRentals.length === 0 ? (
              <p className="dashboard-empty-note">최근 대여 내역이 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="egg-table">
                  <thead>
                    <tr>
                      <th>기간</th>
                      <th>대여자</th>
                      <th>과정명</th>
                      <th>상태</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRentals.map((rental) => {
                      const state = getRentalStateLabel(rental, today);
                      return (
                        <tr key={rental.id} className={`egg-row-${state.tone}`}>
                          <td>
                            {formatRange(rental.startDate, rental.returnDueDate)}
                            {rental.actualUseNote ? <span>실사용 {rental.actualUseNote}</span> : null}
                          </td>
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
                              deviceLabel={device.label}
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
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? (mono ? "egg-mono" : "") : "egg-empty-value"}>{value || "없음"}</dd>
    </div>
  );
}

/** "Dev User님이 표시 (26.10.30)" — 표시 시각은 KST 날짜로 보여준다 */
function formatExhaustedBy(device: EggDeviceSummary): string {
  const who = device.dataExhaustedBy ? `${device.dataExhaustedBy}님이 표시` : "소진 표시됨";
  if (!device.dataExhaustedAt) return who;
  const date = kstToday(new Date(device.dataExhaustedAt));
  return `${who} (${date.slice(2).replaceAll("-", ".")})`;
}
