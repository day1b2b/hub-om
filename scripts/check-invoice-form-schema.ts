import { checkInvoiceRequestFormSchema, hasInvoiceRequestFormDrift } from "../src/lib/data/invoiceRequestFormSchemaCheck";

async function main(): Promise<void> {
  const drift = await checkInvoiceRequestFormSchema();
  if (!hasInvoiceRequestFormDrift(drift)) {
    console.log("[check-invoice-form-schema] 변경 없음 — 계산서 발행 요청 폼 entry ID는 그대로입니다.");
    return;
  }

  console.error("[check-invoice-form-schema] 계산서 발행 요청 구글폼이 바뀌었습니다!");
  for (const q of drift.added) console.error(`  + 새 질문: "${q.title}" (entry.${q.entryId})`);
  for (const q of drift.removed) console.error(`  - 사라진 질문: "${q.title}" (entry.${q.entryId})`);
  for (const q of drift.changedTitle) console.error(`  ~ 제목 변경 (entry.${q.entryId}): "${q.from}" -> "${q.to}"`);
  console.error("  src/lib/data/invoiceRequestFormSchema.ts와 invoiceRequestForm.ts의 entry ID를 다시 확인해 주세요.");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[check-invoice-form-schema] 확인 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
