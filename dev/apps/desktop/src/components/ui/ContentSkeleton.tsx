const ROW_WIDTHS = ["w-11/12", "w-2/3", "w-4/5", "w-1/2", "w-3/4"] as const;

/**
 * Modal body while a short read is in flight. It fills the panel at once,
 * while the loading line waits `LOADING_APPEAR_DELAY_MS`.
 */
export function ContentSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="min-h-40 animate-pulse space-y-3 py-2 motion-reduce:animate-none"
    >
      {ROW_WIDTHS.map((width) => (
        <div
          key={width}
          aria-hidden
          className={`h-2.5 rounded bg-on-surface-variant/20 ${width}`}
        />
      ))}
    </div>
  );
}
