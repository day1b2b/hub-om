import { Suspense } from "react";
import { CoachPublicScheduleInput } from "@/features/coaches/CoachPublicScheduleInput";

export default function CoachPage() {
  return (
    <Suspense fallback={<main className="coach-public-shell"><p>불러오는 중...</p></main>}>
      <CoachPublicScheduleInput />
    </Suspense>
  );
}
