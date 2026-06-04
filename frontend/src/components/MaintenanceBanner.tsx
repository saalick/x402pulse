/**
 * Sticky banner shown above the header while the indexer is mid-backfill.
 * Theme-aware (warn token). Remove the <MaintenanceBanner /> render from
 * Header.tsx (or just delete this file) once the backfill is complete.
 */
export function MaintenanceBanner() {
  return (
    <div className="border-b border-warn/30 bg-warn-bg">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1.5 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-warn sm:text-xs">
        <span aria-hidden>⚠</span>
        <span>Under Maintenance — backfilling historical data, totals may be partial</span>
      </div>
    </div>
  );
}
