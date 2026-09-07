import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { listCalendarEventLinks, deleteMatchingCalendarEventLink } from "./calendarEventLinkRepository";
import { isCalendarWriteEnabled } from "./calendarWriteConfig";
import { readCalendarCreationProof, deleteEvent } from "./calendarWriteClient";
import { calendarOperationRevision } from "./calendarOperationRevision";
import { withCalendarOperationLock } from "./calendarOperationLock";
import { signCalendarCleanup, verifyCalendarCleanup } from "./calendarCleanupToken";

const MAX_EVENTS = 100;
export async function previewBackfilledCalendarCleanup(operationIds: string[]) {
  if (!isCalendarWriteEnabled()) throw new Error("캘린더 연동이 꺼져 있습니다.");
  if (operationIds.length === 0 || operationIds.length > 20 || operationIds.some(id => !id || id.length > 500)) throw new Error("미리보기는 회차 ID 1~20개를 지정해야 합니다.");
  const candidates: { operationId: string; eventDate: string; eventId: string; token: string }[] = [];
  const skipped: { operationId: string; eventId?: string; reason: string }[] = [];
  let scanned = 0;
  for (const operationId of new Set(operationIds)) {
    const operation = await getOperationRepository().getOperationById(operationId);
    if (!operation) { skipped.push({ operationId, reason: "회차 없음" }); continue; }
    const links = await listCalendarEventLinks(operationId);
    if (scanned + links.length > MAX_EVENTS) throw new Error("미리보기 상한(100개)을 초과했습니다. 회차 범위를 줄이세요.");
    scanned += links.length;
    for (const link of links) {
      const proof = await readCalendarCreationProof(link.calendarId, link.eventId);
      if (!proof || proof.status === "cancelled" || proof.source !== "backfill" || proof.creationKey !== link.eventId) {
        skipped.push({ operationId, eventId: link.eventId, reason: "소급 생성 출처를 확인할 수 없거나 삭제된 이벤트" }); continue;
      }
      candidates.push({ operationId, eventDate: link.eventDate, eventId: link.eventId, token: signCalendarCleanup({
        version: 1, link, operationRevision: calendarOperationRevision(operation), etag: proof.etag, expiresAt: Date.now() + 15 * 60_000
      }) });
    }
  }
  return { ok: true, dryRun: true, candidates, skipped };
}

export async function applyBackfilledCalendarCleanup(tokens: string[]) {
  if (!isCalendarWriteEnabled()) throw new Error("캘린더 연동이 꺼져 있습니다.");
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > MAX_EVENTS || tokens.some(token => typeof token !== "string")) throw new Error("삭제 미리보기 토큰 1~100개가 필요합니다.");
  // 잘못된 토큰이 하나라도 있으면 어떤 삭제도 시작하지 않는다.
  const claims = [...new Set(tokens)].map(token => verifyCalendarCleanup(token, { allowExpired: true }));
  const outcomes: { operationId: string; eventId: string; ok: boolean; googleDeleted: boolean; detail?: string }[] = [];
  for (const claim of claims) {
    const { link } = claim;
    const outcome = { operationId: link.operationId, eventId: link.eventId, ok: false, googleDeleted: false, detail: undefined as string | undefined };
    outcomes.push(outcome);
    try {
      await withCalendarOperationLock(link.operationId, async () => {
        const current = await getOperationRepository().getOperationById(link.operationId);
        if (!current || calendarOperationRevision(current) !== claim.operationRevision) throw new Error("미리보기 후 회차가 변경되었습니다.");
        const links = await listCalendarEventLinks(link.operationId);
        const matching = links.find(entry => entry.eventDate === link.eventDate);
        if (!matching) { outcome.detail = "이미 정리된 매핑"; return; }
        if (matching.calendarId !== link.calendarId || matching.eventId !== link.eventId) throw new Error("미리보기 후 매핑이 변경되었습니다.");
        const proof = await readCalendarCreationProof(link.calendarId, link.eventId);
        if (proof && proof.status !== "cancelled") {
          if (claim.expiresAt <= Date.now()) throw new Error("삭제 미리보기가 만료되었습니다.");
          if (proof.source !== "backfill" || proof.creationKey !== link.eventId || proof.etag !== claim.etag) throw new Error("미리보기 후 Google 일정 또는 출처가 변경되었습니다.");
          await deleteEvent(link.calendarId, link.eventId, { notifyAttendees: false, expectedEtag: claim.etag });
          outcome.googleDeleted = true;
        }
        // Google 삭제 성공 뒤 DB 실패한 재시도도 서명된 원본 매핑만 정리한다.
        await deleteMatchingCalendarEventLink(link);
      });
      outcome.ok = true;
    } catch (error) { outcome.detail = error instanceof Error ? error.message : String(error); }
  }
  return { ok: outcomes.every(outcome => outcome.ok), dryRun: false, deletedEvents: outcomes.filter(outcome => outcome.googleDeleted).length, failedEvents: outcomes.filter(outcome => !outcome.ok).length, outcomes };
}
