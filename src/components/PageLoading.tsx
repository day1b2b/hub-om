export function PageLoading({ label = "불러오는 중..." }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-spinner" aria-hidden="true" />
      <span className="page-loading-label">{label}</span>
    </div>
  );
}
