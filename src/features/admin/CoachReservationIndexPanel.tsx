"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RepairResponse {
  code?: string;
  ok: boolean;
}

// 코치 포털 진단에서 "코치 일정 저장소 열기"가 ACTIVE_RESERVATION_INDEX_NOT_READY일 때만 보인다.
// 활성 예약 인덱스 1개만 만들며 예약 문서는 바꾸지 않는다. 중복 활성 예약이 있으면 버튼을 막는다.
export function CoachReservationIndexPanel({ duplicateActiveReservations }: { duplicateActiveReservations: number | null }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const blocked = duplicateActiveReservations !== 0;

  async function createIndex() {
    if (blocked || isBusy) return;
    if (!confirm("코치 예약(CoachDayReservation)에 '같은 코치·같은 날짜 활성 예약은 하나' 인덱스 1개를 만듭니다.\n\n예약 데이터는 바꾸지 않습니다. 계속할까요?")) return;

    setIsBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/coach-portal-diagnosis/reservation-index", { method: "POST" });
    const payload = (await response.json().catch(() => ({ ok: false }))) as RepairResponse;
    setIsBusy(false);

    if (!response.ok || !payload.ok) {
      setMessage(`만들지 못했습니다. 코드: ${payload.code ?? response.status}`);
      return;
    }
    setMessage("인덱스를 만들었고 코치 일정 저장소가 열리는 것까지 확인했습니다.");
    router.refresh();
  }

  return (
    <section className="detail-section">
      <div className="section-title">
        <h2>활성 예약 인덱스 만들기</h2>
        <span>코치 일정 저장소가 열리지 않는 원인인 인덱스 1개만 만듭니다. 예약 데이터는 바꾸지 않습니다.</span>
      </div>

      <div className="coach-admin-deleted-panel">
        <div className="coach-admin-deleted-toolbar">
          <span>
            {duplicateActiveReservations === null
              ? "중복 활성 예약을 확인하지 못했습니다."
              : `같은 코치·같은 날짜에 겹친 활성 예약 ${duplicateActiveReservations}묶음`}
          </span>
          <div className="coach-admin-deleted-actions">
            <button disabled={blocked || isBusy} onClick={createIndex} type="button">
              {isBusy ? "만드는 중" : "인덱스 만들기"}
            </button>
          </div>
        </div>

        {blocked && duplicateActiveReservations !== null ? (
          <div className="coach-origin-empty-panel">겹친 예약이 있으면 인덱스를 만들 수 없습니다. 겹친 예약을 먼저 정리해야 합니다.</div>
        ) : null}
        {message ? <div className="coach-origin-empty-panel">{message}</div> : null}
      </div>
    </section>
  );
}
