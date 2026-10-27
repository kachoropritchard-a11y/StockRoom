export function Spinner({ label, fullPage }: { label: string; fullPage?: boolean }) {
  return (
    <div className={fullPage ? 'spinner-page' : 'spinner-inline'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}
