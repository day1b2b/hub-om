// 서버가 뜰 때 한 번 실행된다. 느린 외부 읽기를 미리 해 두어 배포 직후 첫 열람자가 기다리지 않게 한다.
// 기다리지 않고 바로 반환한다 — 서버 시작을 늦추지 않는다. 빌드 중에는 실행하지 않는다.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { warmInvoiceRequestStatuses } = await import("@/lib/data/invoiceRequestStatus");
  warmInvoiceRequestStatuses();
}
