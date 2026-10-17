"use client";

export function LfnSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`lfn-switch ${checked ? "is-on" : ""} ${className}`}
    >
      <span className="lfn-switch-track" aria-hidden="true">
        <span />
      </span>
      <span>{label}</span>
    </button>
  );
}
