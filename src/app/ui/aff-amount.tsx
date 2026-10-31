export function AffIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-amber-600 ${className}`}
    >
      <path
        d="m12 2 9 5v10l-9 5-9-5V7z"
        fill="currentColor"
        fillOpacity=".1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m8 16 4-9 4 9m-6.7-3h5.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function AffAmount({
  amount,
  className = "",
}: {
  amount: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums ${className}`}
    >
      <AffIcon />
      {amount.toLocaleString("zh-CN")}
      <span className="text-[10px] font-medium text-[var(--muted)]">AFF</span>
    </span>
  );
}
