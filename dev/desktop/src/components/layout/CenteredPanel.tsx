import type { ReactNode } from "react";

interface CenteredPanelProps {
  children: ReactNode;
  className?: string;
}

/** Horizontally centered content column (SDD §8.2 — vault list home). */
export function CenteredPanel({ children, className = "" }: CenteredPanelProps) {
  return (
    <div
      className={[
        "mx-auto flex w-full max-w-content flex-1 flex-col px-margin-mobile md:px-margin-desktop",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
