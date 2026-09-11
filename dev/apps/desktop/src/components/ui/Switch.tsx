import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "role"
> {
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
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
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

export interface SwitchRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
}

/** Boolean setting: label on the left, switch on the right (mobile `SwitchRow` parity). */
export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  id: idProp,
}: SwitchRowProps) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <div className="flex items-start gap-3">
      <label
        htmlFor={id}
        className={[
          "min-w-0 flex-1 select-none",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <span
          className={[
            "block text-sm",
            disabled ? "text-on-surface-variant opacity-60" : "text-on-surface",
          ].join(" ")}
        >
          {label}
        </span>
        {hint ? (
          <span
            className={[
              "mt-1.5 block text-xs leading-relaxed",
              disabled ? "text-on-surface-variant opacity-60" : "text-on-surface-variant",
            ].join(" ")}
          >
            {hint}
          </span>
        ) : null}
      </label>
      <Switch
        id={id}
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
