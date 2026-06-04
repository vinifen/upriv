import { type ButtonHTMLAttributes, forwardRef } from "react";

type IconButtonSize = "sm" | "row";
/** `row-action` = vault row icons; hover uses a step above row hover so it stays visible. */
type IconButtonVariant = "default" | "ghost" | "row-action";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
}

const sizeClass: Record<IconButtonSize, string> = {
  sm: "h-9 w-9 rounded-md",
  row: "h-11 min-h-11 w-11 min-w-11 rounded-xl",
};

const variantClass: Record<IconButtonVariant, string> = {
  default:
    "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface active:bg-surface-container-high",
  ghost:
    "bg-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface active:bg-surface-container-high",
  "row-action":
    "bg-transparent text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface active:bg-surface-container-highest",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      size = "sm",
      variant = "default",
      className = "",
      type = "button",
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={[
        "inline-flex shrink-0 items-center justify-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        sizeClass[size],
        variantClass[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  ),
);

IconButton.displayName = "IconButton";
