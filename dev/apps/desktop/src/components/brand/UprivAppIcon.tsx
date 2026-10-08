interface UprivAppIconProps {
  className?: string;
}

/** Inline app icon (same paths as mobile `assets/brand/Upriv-icon.svg` and the `index.html` splash). */
export function UprivAppIcon({ className }: UprivAppIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" className={className} aria-hidden>
      <rect width="256" height="256" rx="52" fill="#0f172a" />
      <g
        transform="translate(28 98)"
        fill="none"
        stroke="#f8fafc"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 14 14 L 2 14" />
        <path d="M 14 14 L 14 48 Q 14 61 28.5 61 Q 43 61 43 48 L 43 14" />
      </g>
      <g
        transform="translate(88 98)"
        fill="none"
        stroke="#6b8cff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.9"
      >
        <path d="M 0 62 L 140 62" />
      </g>
    </svg>
  );
}
