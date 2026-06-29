"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CoachStatusValue } from "@/lib/data/coachTypes";

interface CoachStatusToggleProps {
  coachId: string;
  status: CoachStatusValue;
}

export function CoachStatusToggle({ coachId, status }: CoachStatusToggleProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(status === "inactive" ? "inactive" : "active");
  const [isSaving, setIsSaving] = useState(false);

  async function updateStatus(nextStatus: "active" | "inactive") {
    if (nextStatus === currentStatus || isSaving) return;

    const previousStatus = currentStatus;
    setCurrentStatus(nextStatus);
    setIsSaving(true);

    const response = await fetch(`/api/coaches/${coachId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });

    if (!response.ok) {
      setCurrentStatus(previousStatus);
    } else {
      router.refresh();
    }

    setIsSaving(false);
  }

  return (
    <div className="coach-status-toggle" aria-label="코치 활동 상태">
      <button
        aria-pressed={currentStatus === "active"}
        disabled={isSaving}
        onClick={() => updateStatus("active")}
        type="button"
      >
        활동중
      </button>
      <button
        aria-pressed={currentStatus === "inactive"}
        disabled={isSaving}
        onClick={() => updateStatus("inactive")}
        type="button"
      >
        비활동
      </button>
    </div>
  );
}
