import { type ButtonHTMLAttributes, forwardRef } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className = "", type = "button", children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={[
        "inline-flex h-9 w-9 items-center justify-center rounded-md",
        "text-on-surface-variant transition-colors",
        "hover:bg-surface-container-high hover:text-on-surface",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
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
