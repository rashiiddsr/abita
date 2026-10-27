import { useId } from "react";

/**
 * Logo ABiTA: huruf A di ubin membulat, titik merah = kehadiran/lokasi.
 * `tile` (default) untuk latar terang; `white` untuk latar teal/gelap (sidebar, panel hero).
 * Sumber SVG & ikon: absensi-wajah/brand/.
 */
export function LogoMark({ size = 44, radius, variant = "tile" }: { size?: number; radius?: number; variant?: "tile" | "white" }) {
  const id = useId();
  const white = variant === "white";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="flex-none" aria-label="ABiTA" role="img">
      {!white && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#12A3B0" />
            <stop offset="1" stopColor="#005A64" />
          </linearGradient>
        </defs>
      )}
      <rect width="64" height="64" rx={radius != null ? (radius / size) * 64 : 16} fill={white ? "#FFFFFF" : `url(#${id})`} />
      <path d="M18.5 47 L32 16.5 L45.5 47" fill="none" stroke={white ? "#007A87" : "#FFFFFF"} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="37.5" r="4.4" fill={white ? "#E5484D" : "#FF5C61"} />
    </svg>
  );
}

/** Tulisan "ABiTA" dengan huruf i merah. */
export function Wordmark({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <span className={className} style={{ letterSpacing: "-0.02em" }}>
      AB<span style={{ color: onDark ? "#FF8A8E" : "#E5484D" }}>i</span>TA
    </span>
  );
}

export function Rings({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 380 380" className={className} aria-hidden>
      <g fill="none" stroke="#FFFFFF">
        <circle cx="190" cy="190" r="60" strokeOpacity=".10" />
        <circle cx="190" cy="190" r="100" strokeOpacity=".08" />
        <circle cx="190" cy="190" r="140" strokeOpacity=".06" strokeDasharray="4 6" />
        <circle cx="190" cy="190" r="182" strokeOpacity=".05" />
      </g>
    </svg>
  );
}
