/** Komponen tampilan bergaya aplikasi HP (padanan mobile/lib/ui/widgets.dart). */
import { ChevronRight, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { initials } from "../lib/format";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

// ------------------------------------------------------------------ kartu & teks

export function Card({ children, className, onClick, pad = true }: { children: ReactNode; className?: string; onClick?: () => void; pad?: boolean }) {
  const cls = cx("rounded-[18px] bg-card shadow-[var(--shadow-soft)] dark:border dark:border-line", pad && "p-4", onClick && "w-full text-left active:scale-[.99] transition-transform", className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export const Title = ({ children, className }: { children: ReactNode; className?: string }) => <h1 className={cx("font-display text-[24px] font-bold text-ink", className)}>{children}</h1>;

export const SectionLabel = ({ children }: { children: ReactNode }) => <div className="px-1 pb-2 pt-5 text-[12.5px] font-semibold uppercase tracking-wide text-faint">{children}</div>;

export function Pill({ children, tone = "muted", icon }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "brand" | "muted" | "purple"; icon?: ReactNode }) {
  const t = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", brand: "bg-brand-soft text-brand", muted: "bg-soft text-muted", purple: "bg-purple-bg text-purple" }[tone];
  return <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold", t)}>{icon}{children}</span>;
}

export function IconTile({ icon, tone = "brand", size = 44 }: { icon: ReactNode; tone?: "ok" | "warn" | "bad" | "brand" | "muted" | "purple"; size?: number }) {
  const t = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", brand: "bg-brand-soft text-brand", muted: "bg-soft text-muted", purple: "bg-purple-bg text-purple" }[tone];
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-[14px]", t)} style={{ width: size, height: size }}>
      {icon}
    </span>
  );
}

// ------------------------------------------------------------------ tombol

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; icon?: ReactNode };

export function PrimaryButton({ children, loading, icon, className, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "bg-cta flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-[15.5px] font-bold text-white shadow-[var(--shadow-cta)] transition active:scale-[.98] disabled:opacity-60 disabled:shadow-none",
        className,
      )}
    >
      {loading ? <Loader2 size={19} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, loading, icon, className, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx("flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] border border-line bg-card text-[15px] font-bold text-ink transition active:scale-[.98] disabled:opacity-60", className)}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function DangerButton({ children, loading, icon, className, ...rest }: BtnProps) {
  return (
    <button {...rest} className={cx("flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-bad-bg text-[15px] font-bold text-bad transition active:scale-[.98]", className)}>
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function RoundButton({ children, onClick, label, className, badge }: { children: ReactNode; onClick?: () => void; label: string; className?: string; badge?: number | boolean }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cx("relative flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-95", className ?? "border border-line bg-card text-ink")}>
      {children}
      {!!badge && (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-[17px] items-center justify-center rounded-full border-2 border-bg bg-brand px-1 text-[9px] font-extrabold text-white">
          {typeof badge === "number" ? badge : ""}
        </span>
      )}
    </button>
  );
}

export function FilterPill({ children, selected, onClick }: { children: ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx("h-9 shrink-0 rounded-full px-4 text-[13.5px] font-semibold transition", selected ? "bg-brand text-white" : "border border-line bg-card text-muted")}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, items, onChange }: { value: T; items: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-[14px] bg-soft p-1">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={cx("flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[11px] text-[13.5px] font-semibold transition", value === it.value ? "bg-card text-brand shadow-[var(--shadow-soft)]" : "text-muted")}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ daftar

export function ListRow({ icon, iconTone, title, subtitle, trailing, onClick, danger }: { icon?: ReactNode; iconTone?: "ok" | "warn" | "bad" | "brand" | "muted" | "purple"; title: string; subtitle?: string; trailing?: ReactNode; onClick?: () => void; danger?: boolean }) {
  const inner = (
    <>
      {icon && <IconTile icon={icon} tone={danger ? "bad" : (iconTone ?? "muted")} size={38} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx("truncate text-[15px] font-semibold", danger ? "text-bad" : "text-ink")}>{title}</span>
        {subtitle && <span className="truncate text-[12.5px] text-muted">{subtitle}</span>}
      </span>
      {trailing ?? (onClick && <ChevronRight size={18} className="shrink-0 text-faint" />)}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-soft">
      {inner}
    </button>
  ) : (
    <div className="flex w-full items-center gap-3 px-4 py-3">{inner}</div>
  );
}

export function ListGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-[18px] bg-card shadow-[var(--shadow-soft)] dark:border dark:border-line">{children}</div>;
}

export function DateBadge({ day, tone = "ok" }: { day: string; tone?: "ok" | "warn" | "brand" }) {
  const t = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", brand: "bg-brand-soft text-brand" }[tone];
  const [, , d] = day.split("-");
  const wd = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"][new Date(day + "T00:00:00Z").getUTCDay()];
  return (
    <span className={cx("flex size-12 shrink-0 flex-col items-center justify-center rounded-[14px]", t)}>
      <span className="text-[11px] font-semibold leading-none">{wd}</span>
      <span className="font-display text-[18px] font-bold leading-tight">{Number(d)}</span>
    </span>
  );
}

export function Avatar({ name, src, size = 46, onDark }: { name: string; src?: string | null; size?: number; onDark?: boolean }) {
  return (
    <span
      className={cx("flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold", onDark ? "bg-white/18 text-white ring-2 ring-white/30" : "bg-brand-soft text-brand")}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

/** Ilustrasi kosong standar. */
export function Empty({ title = "Tidak ada data" }: { title?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <svg width="64" height="64" viewBox="0 0 72 72" fill="none" aria-hidden className="text-faint">
        <rect x="14" y="10" width="36" height="46" rx="5" className="fill-soft" stroke="currentColor" strokeWidth="2" />
        <path d="M22 22h20M22 30h14M22 38h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="47" cy="45" r="10" className="fill-card" stroke="currentColor" strokeWidth="2.5" />
        <path d="m54.5 52.5 6 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="text-sm font-semibold text-ink">{title}</span>
    </div>
  );
}

export const Spinner = ({ size = 26, className }: { size?: number; className?: string }) => <Loader2 size={size} className={cx("animate-spin text-brand", className)} />;

export function Skel({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-[14px] bg-soft", className)} />;
}

// ------------------------------------------------------------------ input

export const inputCls =
  "h-[50px] w-full rounded-[14px] border border-transparent bg-soft px-4 text-[16px] text-ink outline-none transition placeholder:text-faint focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand/15";

export function Field({ label, children, action, hint }: { label: string; children: ReactNode; action?: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[13px] font-semibold text-muted">
        {label}
        {action}
      </span>
      {children}
      {hint && <span className="px-0.5 text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ lembar dari bawah (bottom sheet)

export function Sheet({ open, onClose, children, title, dismissible = true }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; dismissible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissible && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, dismissible]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="animate-fade absolute inset-0 bg-black/45" onClick={() => dismissible && onClose()} />
      <div
        ref={ref}
        role="dialog"
        aria-modal
        className="animate-sheet pb-safe relative flex max-h-[92dvh] w-full max-w-[480px] flex-col rounded-t-[24px] bg-card"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: drag ? "none" : undefined }}
      >
        {/* pegangan: geser ke bawah untuk menutup */}
        <div
          className="flex shrink-0 justify-center pb-1.5 pt-2.5"
          onPointerDown={(e) => dismissible && ((start.current = e.clientY), (e.target as HTMLElement).setPointerCapture(e.pointerId))}
          onPointerMove={(e) => start.current !== null && setDrag(Math.max(0, e.clientY - start.current))}
          onPointerUp={() => {
            if (drag > 90) onClose();
            setDrag(0);
            start.current = null;
          }}
        >
          <span className="h-1 w-9 rounded-full bg-line" />
        </div>
        {title && (
          <div className="flex items-center gap-2 px-5 pb-2">
            <span className="font-display flex-1 text-[19px] font-bold text-ink">{title}</span>
            {dismissible && (
              <button type="button" aria-label="Tutup" onClick={onClose} className="flex size-9 items-center justify-center rounded-full text-muted active:bg-soft">
                <X size={19} />
              </button>
            )}
          </div>
        )}
        {/* keyboard iPhone menutupi bagian bawah lembar: kolom yang aktif digulir ke tengah setelah keyboard muncul */}
        <div
          className="no-scrollbar overflow-y-auto px-5 pb-5"
          onFocus={(e) => {
            const el = e.target as HTMLElement;
            if (el.matches("input, textarea, select")) setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Konfirmasi dari bawah: ikon, judul, pesan, tombol utama, Batal. */
export function ConfirmSheet({ open, icon, title, message, confirm, danger, loading, onConfirm, onClose }: { open: boolean; icon: ReactNode; title: string; message?: string; confirm: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col items-stretch gap-1 pt-2 text-center">
        <span className={cx("mx-auto mb-2 flex size-16 items-center justify-center rounded-full", danger ? "bg-bad-bg text-bad" : "bg-brand-soft text-brand")}>{icon}</span>
        <span className="font-display text-[20px] font-bold text-ink">{title}</span>
        {message && <span className="whitespace-pre-line text-[14px] leading-relaxed text-muted">{message}</span>}
        <div className="mt-5 flex flex-col gap-2">
          {danger ? (
            <DangerButton loading={loading} onClick={onConfirm}>
              {confirm}
            </DangerButton>
          ) : (
            <PrimaryButton loading={loading} onClick={onConfirm}>
              {confirm}
            </PrimaryButton>
          )}
          <button type="button" onClick={onClose} className="h-11 text-[15px] font-bold text-muted">
            Batal
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ toast

const ToastCtx = createContext<(msg: string, tone?: "ok" | "bad") => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; tone: "ok" | "bad"; id: number } | null>(null);
  const show = useCallback((msg: string, tone: "ok" | "bad" = "ok") => setT({ msg, tone, id: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const h = window.setTimeout(() => setT(null), 3200);
    return () => window.clearTimeout(h);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4">
            <div key={t.id} className={cx("animate-fade pointer-events-auto max-w-[440px] rounded-[14px] px-4 py-3 text-[14px] font-semibold shadow-lg", t.tone === "bad" ? "bg-bad text-white" : "bg-ink text-bg")}>
              {t.msg}
            </div>
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
