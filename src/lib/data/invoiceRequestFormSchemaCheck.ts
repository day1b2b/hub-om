import { INVOICE_REQUEST_FORM_SNAPSHOT, INVOICE_REQUEST_FORM_URL, type InvoiceRequestFormQuestion } from "./invoiceRequestFormSchema";

export interface InvoiceRequestFormDrift {
  added: InvoiceRequestFormQuestion[];
  removed: InvoiceRequestFormQuestion[];
  changedTitle: { entryId: number; from: string; to: string }[];
}

/** 구글폼 뷰 HTML에 박혀 있는 FB_PUBLIC_LOAD_DATA_ 스크립트에서 질문 목록을 꺼낸다. */
export function parseInvoiceRequestFormHtml(html: string): InvoiceRequestFormQuestion[] {
  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\])\s*;\s*<\/script>/);
  if (!match) throw new Error("FB_PUBLIC_LOAD_DATA_를 찾지 못했습니다 — 구글폼 페이지 구조가 바뀌었을 수 있습니다.");

  const data = JSON.parse(match[1]) as unknown[];
  const items = (data[1] as unknown[])[1] as unknown[][];
  return items.map((item) => ({
    title: String(item[1]).trim(),
    entryId: Number((item[4] as unknown[][])[0][0])
  }));
}

export function diffInvoiceRequestFormSchema(
  live: InvoiceRequestFormQuestion[],
  snapshot: InvoiceRequestFormQuestion[] = INVOICE_REQUEST_FORM_SNAPSHOT
): InvoiceRequestFormDrift {
  const liveById = new Map(live.map((q) => [q.entryId, q]));
  const snapshotById = new Map(snapshot.map((q) => [q.entryId, q]));

  const added = live.filter((q) => !snapshotById.has(q.entryId));
  const removed = snapshot.filter((q) => !liveById.has(q.entryId));
  const changedTitle = snapshot
    .filter((q) => liveById.has(q.entryId) && liveById.get(q.entryId)!.title !== q.title)
    .map((q) => ({ entryId: q.entryId, from: q.title, to: liveById.get(q.entryId)!.title }));

  return { added, removed, changedTitle };
}

export function hasInvoiceRequestFormDrift(drift: InvoiceRequestFormDrift): boolean {
  return drift.added.length > 0 || drift.removed.length > 0 || drift.changedTitle.length > 0;
}

/** 라이브 폼을 읽어 커밋된 스냅샷과 비교한다. 네트워크 호출이라 테스트에서는 직접 쓰지 않는다. */
export async function checkInvoiceRequestFormSchema(): Promise<InvoiceRequestFormDrift> {
  const response = await fetch(INVOICE_REQUEST_FORM_URL);
  if (!response.ok) throw new Error(`구글폼을 불러오지 못했습니다 (HTTP ${response.status}).`);
  const html = await response.text();
  const live = parseInvoiceRequestFormHtml(html);
  return diffInvoiceRequestFormSchema(live);
}
