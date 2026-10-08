import { RevealPathButton } from "@/components/RevealPathButton";

interface PathFieldProps {
  value: string;
  /** Location the button opens. Defaults to `value`. */
  openPath?: string | null;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  className?: string;
}

/**
 * One path rectangle with the file-manager button inside it.
 * The button is a flex sibling, so it stays inside the rounded box.
 */
export function PathField({
  value,
  openPath,
  onChange,
  readOnly = false,
  disabled = false,
  placeholder,
  id,
  invalid = false,
  className = "",
}: PathFieldProps) {
  const locked = readOnly || disabled || !onChange;
  return (
    <div
      className={[
        "flex min-h-10 min-w-0 items-stretch overflow-hidden rounded-lg bg-surface-container-highest",
        invalid
          ? "ring-2 ring-on-error-container"
          : "ring-0 focus-within:ring-2 focus-within:ring-accent/40",
        disabled ? "opacity-60" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        id={id}
        type="text"
        value={value}
        readOnly={locked}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid ? true : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={[
          "min-w-0 flex-1 border-0 bg-transparent px-3 py-2 font-mono text-xs text-on-surface outline-none",
          "placeholder:text-on-surface-variant",
          locked ? "cursor-default" : "",
          disabled ? "cursor-not-allowed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      />
      <RevealPathButton path={openPath ?? value} inset />
    </div>
  );
}
