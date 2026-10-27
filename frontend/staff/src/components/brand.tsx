/** Logo ABiTA: huruf A di ubin membulat, titik merah = kehadiran/lokasi. */
export function AbitaMark({ size = 40, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="abita-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12A3B0" />
          <stop offset="1" stopColor="#005A64" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={onDark ? "#FFFFFF" : "url(#abita-g)"} />
      <path d="M18.5 47 L32 16.5 L45.5 47" fill="none" stroke={onDark ? "#007A87" : "#FFFFFF"} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="37.5" r="4.4" fill={onDark ? "#E5484D" : "#FF5C61"} />
    </svg>
  );
}

/** Tulisan "ABiTA" dengan huruf i merah. */
export function Wordmark({ onDark = false, className = "text-[20px]" }: { onDark?: boolean; className?: string }) {
  return (
    <span className={`font-extrabold leading-tight tracking-tight ${onDark ? "text-white" : "text-ink"} ${className}`}>
      AB<span className={onDark ? "text-[#FF8A8E]" : "text-[#E5484D]"}>i</span>TA
    </span>
  );
}

export function OrgLogo({ org, onDark = true }: { org: string; onDark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <AbitaMark size={40} onDark={onDark} />
      <span className="flex flex-col">
        <Wordmark onDark={onDark} className="text-[18px]" />
        <span className={`text-[10px] font-bold uppercase tracking-[.06em] ${onDark ? "text-white/80" : "text-muted"}`}>{org}</span>
      </span>
    </span>
  );
}
