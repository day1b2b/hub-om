// 표 안에서 외부 링크를 아이콘 하나로 보여준다(운영현황·내 대시보드 공용).
// 값이 없거나 http(s)가 아니면 링크를 만들지 않고 "-"로 둔다.

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function ExternalTableLink({ href, label = "싱크업 열기" }: { href: string; label?: string }) {
  if (!isSafeHttpUrl(href)) return <span className="muted-inline">-</span>;

  return (
    <a aria-label={label} className="table-link-icon" href={href} rel="noreferrer" target="_blank">
      ↗
    </a>
  );
}
