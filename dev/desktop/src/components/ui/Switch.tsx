import { useId, type ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  id: idProp,
  className = "",
  disabled = false,
  ...props
}: SwitchProps) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "bg-accent" : "bg-surface-container-highest",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <span
        aria-hidden
        className={[
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-on-primary shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
