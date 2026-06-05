import type { ReactNode, SVGAttributes } from "react";

export type IconName =
  | "add"
  | "archive"
  | "arrow-down"
  | "arrow-up"
  | "backups"
  | "chevron-down"
  | "clock"
  | "download"
  | "encrypted"
  | "eye-off"
  | "file"
  | "grip-vertical"
  | "folder"
  | "help"
  | "lock"
  | "minus"
  | "lock-open"
  | "more-horizontal"
  | "more-vertical"
  | "note"
  | "layout-grid"
  | "list-rows"
  | "list-rows-loose"
  | "list-rows-tight"
  | "refresh"
  | "sort-alpha"
  | "sort-state"
  | "seal"
  | "settings"
  | "sort"
  | "terminal"
  | "trash";

const paths: Record<IconName, ReactNode> = {
  add: (
    <>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  archive: (
    <>
      <path
        d="M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="none"
        strokeLinejoin="round"
      />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path d="M10 12h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  backups: (
    <>
      <path
        d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.9-1.1A4 4 0 1 1 17 18H7z"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="none"
      />
      <path d="M12 12v6M9 15l3 3 3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "arrow-up": (
    <path d="M12 5v14M7 10l5-5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  "arrow-down": (
    <path d="M12 5v14M7 14l5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  "chevron-down": <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  download: (
    <>
      <path
        d="M12 4v10M8 10l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M5 18h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  encrypted: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.75" fill="none" />
    </>
  ),
  "eye-off": (
    <>
      <path
        d="M10.7 10.7a2.5 2.5 0 0 0 3.5 3.5M6.3 6.3C4.6 7.6 3.3 9.4 2.5 12c1.7 4.2 6 7 9.5 7 1.4 0 2.8-.4 4.1-1.1M9.9 5.1A10.8 10.8 0 0 1 12 5c3.5 0 7.8 2.8 9.5 7-.6 1.5-1.6 2.9-2.8 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  "grip-vertical": (
    <>
      <circle cx="9" cy="6" r="1.25" fill="currentColor" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" />
      <circle cx="9" cy="18" r="1.25" fill="currentColor" />
      <circle cx="15" cy="6" r="1.25" fill="currentColor" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" />
      <circle cx="15" cy="18" r="1.25" fill="currentColor" />
    </>
  ),
  folder: (
    <>
      <path
        d="M4 8h6l2 2h8v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M4 8V6a2 2 0 0 1 2-2h4l2 2" stroke="currentColor" strokeWidth="1.75" fill="none" />
    </>
  ),
  file: (
    <>
      <path
        d="M8 4h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" fill="none" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.2 1.8c0 2-2.7 2.2-2.7 3.7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="17" r="0.75" fill="currentColor" />
    </>
  ),
  minus: (
    <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.75" fill="none" />
    </>
  ),
  "lock-open": (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path d="M8 11V8a4 4 0 0 1 8 0" stroke="currentColor" strokeWidth="1.75" fill="none" />
    </>
  ),
  "more-horizontal": (
    <>
      <circle cx="5" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="19" cy="12" r="1.25" fill="currentColor" />
    </>
  ),
  "more-vertical": (
    <>
      <circle cx="12" cy="5" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="19" r="1.25" fill="currentColor" />
    </>
  ),
  note: (
    <>
      <path d="M7 4h10a2 2 0 0 1 2 2v14l-4-3H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.75" fill="none" strokeLinejoin="round" />
      <path d="M11 9h6M11 13h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  refresh: (
    <>
      <path d="M4 12a8 8 0 0 1 13.5-5.7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" fill="none" />
      <path d="M20 3v5h-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M20 12a8 8 0 0 1-13.5 5.7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" fill="none" />
      <path d="M4 21v-5h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  seal: (
    <>
      <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z" stroke="currentColor" strokeWidth="1.75" fill="none" strokeLinejoin="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <path d="M7 10l3 3-3 3M12 16h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  sort: (
    <>
      <path d="M4 8h8M4 12h6M4 16h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M16 6v12M13 9l3-3 3 3M13 15l3 3 3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "layout-grid": (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75" fill="none" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75" fill="none" />
    </>
  ),
  "list-rows": (
    <>
      <path d="M5 7h14M5 12h14M5 17h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  "list-rows-loose": (
    <>
      <path d="M5 6h14M5 12h14M5 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  "list-rows-tight": (
    <>
      <path d="M5 8h14M5 12h14M5 16h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  "sort-alpha": (
    <>
      <path d="M8 6h8M8 10h6M8 14h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M16 6v12M14 8l2-2 2 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  "sort-state": (
    <>
      <circle cx="8" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="16" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="16" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M9.5 10.5L11 14M14.5 10.5L13 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  trash: (
    <>
      <path
        d="M4 7h16M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M9 11v7M12 11v7M15 11v7M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </>
  ),
};

export interface IconProps extends SVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className = "", ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
