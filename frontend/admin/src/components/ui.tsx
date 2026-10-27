import { toneStyle } from "@/lib/status";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, Minus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Tone } from "@/lib/status";
import { useAvatarVersion } from "@/lib/avatar-version";
import { initials } from "@/lib/format";
import { apiUrl } from "@/lib/api";

export function cx(...c: (string | number | false | null | undefined)[]) {
  return c.filter((x) => typeof x === "string" && x).join(" ");
}

// ------------------------------------------------------------------ kartu & teks

/** `enterScope`: kolom isian di kartu ini satu kelompok (Enter = kolom berikutnya, terakhir = tombol data-submit). */
export function Card({ className, children, onClick, enterScope }: { className?: string; children: ReactNode; onClick?: () => void; enterScope?: boolean }) {
  return (
    <div onClick={onClick} data-enter-scope={enterScope || undefined} className={cx("rounded-xl border border-line bg-card shadow-card", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        {sub && <span className="text-[13px] text-muted">{sub}</span>}
      </div>
      {action}
    </div>
  );
}

/** Baris aksi halaman (judul halaman sudah tampil di navbar). */
/** Baris atas halaman: tab utama di kiri (PillTabs), aksi di kanan. Judul ada di navbar. */
export function PageHeader({ left, action }: { title?: string; sub?: string; left?: ReactNode; action?: ReactNode }) {
  if (!left && !action) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {left}
      {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function LinkBtn({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-none items-center gap-0.5 py-1 text-[13px] font-medium text-brand hover:text-brand-dark">
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="mt-1 text-xs font-medium uppercase tracking-wide text-faint">{children}</span>;
}

// ------------------------------------------------------------------ badge & chip

export function Pill({ tone, dot = true, className, children }: { tone: Tone; dot?: boolean; className?: string; children?: ReactNode }) {
  return (
    <span className={cx("inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", className)} style={toneStyle(tone.bg, tone.fg)}>
      {dot && <span className="size-1.5 flex-none rounded-full bg-current" />}
      {children ?? tone.label}
    </span>
  );
}

export function Tag({ tone, children, className }: { tone: Tone; children?: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", className)} style={toneStyle(tone.bg, tone.fg)}>
      {children ?? tone.label}
    </span>
  );
}

export function GreyTag({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-soft px-2 py-0.5 text-xs font-medium text-muted">
      {icon}
      {children}
    </span>
  );
}

/** Tab filter berbentuk segmen (pengganti chip bulat). */
export function Chip({ active, label, count, dot, icon, onClick }: { active: boolean; label: string; count?: number | string; dot?: string; icon?: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
        active ? "border-strong bg-strong text-on-strong" : "border-line bg-card text-muted hover:text-ink",
      )}
    >
      {icon}
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}
      {label}
      {count !== undefined && <span className={cx("tnum text-xs", active ? "text-white/70" : "text-faint")}>{count}</span>}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("grid auto-cols-fr grid-flow-col rounded-lg bg-soft p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              "whitespace-nowrap rounded-md px-3 font-medium transition-colors",
              size === "sm" ? "h-7 text-[13px]" : "h-8 text-[13px]",
              on ? "bg-raised text-ink shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ input

const control = "rounded-lg border border-line bg-field text-ink outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-2 focus:ring-brand/15";

export function SearchBox({ value, onChange, placeholder = "Cari nama atau NIK", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label
      className={cx(
        "flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-field px-2.5 text-faint focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15 sm:w-[260px]",
        className,
      )}
    >
      <Search size={15} className="flex-none" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full min-w-0 bg-transparent text-[13px] text-ink outline-none" />
      {value && (
        <button onClick={() => onChange("")} aria-label="Hapus pencarian" className="text-faint hover:text-ink">
          <X size={14} />
        </button>
      )}
    </label>
  );
}

export function Select({ value, onChange, options, className, big }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; big?: boolean }) {
  return (
    <label className={cx("relative flex items-center", className)}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(control, "w-full appearance-none pl-2.5 pr-8 text-[13px]", big ? "h-10" : "h-9")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-2.5 text-muted" />
    </label>
  );
}

/** Filter unit halaman terkunci mengikuti pilihan unit di sidebar (Admin SDM). */
export function LockedScope({ label }: { label: string }) {
  return (
    <span title="Mengikuti filter unit di sidebar" className="flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-line bg-soft px-2.5 text-[13px] text-muted">
      <LockIcon />
      {label}
    </span>
  );
}

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5zM8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export const inputCls = cx(control, "h-10 w-full px-3 text-sm");
export const textareaCls = cx(control, "w-full resize-none px-3 py-2.5 text-sm leading-normal");

export function FormRow({ label, required, error, children, hint }: { label: string; required?: boolean; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">
        {label} {required && <span className="text-bad">*</span>}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-faint">{hint}</span>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={cx("relative h-5 w-9 flex-none rounded-full p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50", on ? "bg-brand" : "bg-off")}
    >
      <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(16,24,40,.2)] transition-[left]", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function Checkbox({ on, onChange, children }: { on: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <button onClick={onChange} className="flex items-center gap-2 py-1.5 text-left text-[13px] text-ink">
      <span className={cx("flex size-4 flex-none items-center justify-center rounded text-white", on ? "bg-brand" : "border border-off bg-card")}>{on && <Check size={12} strokeWidth={3} />}</span>
      {children}
    </button>
  );
}

/** Kotak centang baris tabel (pilih banyak); `some` = sebagian terpilih (header "pilih semua"). */
export function SelectBox({ on, some, onClick, label, disabled }: { on: boolean; some?: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={(e) => (e.stopPropagation(), onClick())}
      className={cx("flex size-4 flex-none items-center justify-center rounded p-0 text-white disabled:cursor-not-allowed disabled:opacity-40", on || some ? "bg-brand" : "border border-off bg-card")}
    >
      {on ? <Check size={12} strokeWidth={3} /> : some ? <Minus size={12} strokeWidth={3} /> : null}
    </button>
  );
}

// ------------------------------------------------------------------ urutkan tabel

export type SortState<K extends string> = { key: K; dir: "asc" | "desc" } | null;
type SortValue = string | number | null | undefined;
const collator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });

/**
 * Urutan baris tabel lewat klik judul kolom: A–Z / kecil–besar → Z–A / besar–kecil → urutan bawaan.
 * Nilai kosong selalu di bawah. Urutkan SEBELUM dipotong per halaman.
 */
export function useSort<T, K extends string>(rows: T[], by: Record<K, (r: T) => SortValue>) {
  const [sort, setSort] = useState<SortState<K>>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = by[sort.key];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const ex = x == null || x === "";
      const ey = y == null || y === "";
      if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
      return dir * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
    });
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key: K) => setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  return { sorted, sort, toggle };
}

/** Judul kolom yang bisa diklik untuk mengurutkan (lihat useSort). */
export function SortHead<K extends string>({ label, k, sort, onSort, align }: { label: string; k: K; sort: SortState<K>; onSort: (k: K) => void; align?: "right" }) {
  const on = sort?.key === k;
  const Icon = !on ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-label={`Urutkan ${label}`}
      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={cx("group flex min-w-0 items-center gap-1 p-0 text-left text-xs font-medium hover:text-ink", on ? "text-ink" : "text-muted", align === "right" && "justify-end")}
    >
      <span className="truncate">{label}</span>
      <Icon size={12} className={cx("flex-none transition-opacity", on ? "opacity-100" : "opacity-40 group-hover:opacity-80")} />
    </button>
  );
}

// ------------------------------------------------------------------ tombol

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "soft" | "danger" | "ghost" | "dangerOutline";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    outline: "border border-line bg-card text-ink hover:bg-soft",
    dangerOutline: "border border-line bg-card text-bad hover:bg-bad-bg",
    soft: "bg-brand-soft text-brand hover:opacity-90",
    danger: "bg-bad text-white hover:bg-[#ad2223]",
    ghost: "bg-transparent text-brand hover:bg-brand-soft",
  }[variant];
  const s = {
    sm: "h-8 px-3 text-[13px]",
    md: "h-9 px-3.5 text-[13px]",
    lg: "h-10 px-4 text-sm",
  }[size];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx("flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-55", v, s, className)}
    >
      {loading && <Spinner light={variant === "primary" || variant === "danger"} size={14} />}
      {children}
    </button>
  );
}

export function IconBtn({ label, onClick, children, className }: { label: string; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className={cx("flex size-8 flex-none items-center justify-center rounded-lg text-muted hover:bg-soft hover:text-ink", className)}>
      {children}
    </button>
  );
}

export function Spinner({ light, size = 16 }: { light?: boolean; size?: number }) {
  return (
    <span
      className="animate-spin-slow inline-block flex-none rounded-full border-2"
      style={{
        width: size,
        height: size,
        borderColor: light ? "rgba(255,255,255,.35)" : "var(--color-line)",
        borderTopColor: light ? "#fff" : "#007A87",
      }}
    />
  );
}

// ------------------------------------------------------------------ avatar

export function Avatar({
  name,
  size = 36,
  radius = 999,
  bg = "#E5F3F4",
  fg = "#005A64",
  userId,
  photo,
}: {
  name: string;
  size?: number;
  radius?: number;
  bg?: string;
  fg?: string;
  userId?: number;
  photo?: boolean;
}) {
  const version = useAvatarVersion();
  const style = {
    width: size,
    height: size,
    borderRadius: radius,
    background: bg,
    color: fg,
    fontSize: Math.round(size * 0.38),
  };
  if (photo && userId) {
    return <img src={apiUrl(`/api/v1/users/${userId}/avatar?v=${version}`)} alt="" style={style} className="flex-none object-cover" />;
  }
  return (
    <span style={style} className="flex flex-none items-center justify-center font-medium">
      {initials(name)}
    </span>
  );
}

// ------------------------------------------------------------------ status kosong / skeleton

export function Skel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={cx("block rounded-md bg-skel", className)} style={style} />;
}

/** Ilustrasi kosong: dokumen + kaca pembesar, mengikuti warna tema. */
function EmptyArt({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden className="text-faint">
      <rect x="14" y="10" width="36" height="46" rx="5" className="fill-soft" stroke="currentColor" strokeWidth="2" />
      <path d="M22 22h20M22 30h14M22 38h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="47" cy="45" r="10" className="fill-card" stroke="currentColor" strokeWidth="2.5" />
      <path d="m54.5 52.5 6 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Keadaan kosong standar untuk tabel & daftar. */
export function Empty({ title = "Tidak ada data", action, compact }: { title?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center gap-2 px-6 text-center", compact ? "py-7" : "py-12")}>
      <EmptyArt size={compact ? 52 : 68} />
      <span className="text-sm font-semibold text-ink">{title}</span>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-bad-bg text-bad">
        <X size={20} />
      </span>
      <span className="mt-1 text-sm font-semibold">Data gagal dimuat</span>
      <span className="max-w-[420px] text-[13px] text-muted">{message}</span>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="mt-2">
          Coba lagi
        </Button>
      )}
    </Card>
  );
}

/** Pagination sisi klien: "1–20 dari 57" + navigasi halaman. */
export function Pager({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;
  const nums = [...Array(pages)].map((_, i) => i).filter((i) => pages <= 7 || i === 0 || i === pages - 1 || Math.abs(i - page) <= 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
      <span className="tnum">
        {page * perPage + 1}–{Math.min(total, (page + 1) * perPage)} dari {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          aria-label="Sebelumnya"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="flex size-8 items-center justify-center rounded-lg border border-line bg-field text-ink disabled:text-off"
        >
          <ChevronLeft size={15} />
        </button>
        {nums.map((i, k) => (
          <span key={i} className="flex items-center gap-1">
            {k > 0 && i - nums[k - 1] > 1 && <span className="px-1 text-faint">…</span>}
            <button onClick={() => onPage(i)} className={cx("tnum h-8 min-w-8 rounded-lg px-2 text-[13px] font-medium", i === page ? "bg-strong text-on-strong" : "text-muted hover:bg-soft")}>
              {i + 1}
            </button>
          </span>
        ))}
        <button
          aria-label="Berikutnya"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          className="flex size-8 items-center justify-center rounded-lg border border-line bg-field text-ink disabled:text-off"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ modal & drawer

export function Modal({ open, onClose, children, width = 440, top = 110 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; top?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  // buka: kolom pertama langsung aktif (hanya mouse/keyboard; di layar sentuh tidak memunculkan keyboard),
  // halaman di belakang tidak ikut tergulir; tutup: fokus kembali ke tombol pembuka
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (matchMedia("(pointer: fine)").matches) box.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([disabled]), textarea:not([disabled]), select:not([disabled])")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (prev?.isConnected) prev.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div onClick={onClose} className="fixed inset-0 bg-[rgba(13,23,38,.4)]" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        className="animate-rise relative mx-auto mb-10 flex w-[calc(100%-32px)] flex-col gap-4 rounded-xl bg-card p-5 shadow-pop"
        style={{ maxWidth: width, marginTop: `min(${top}px, 10vh)` }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHead({ title, sub, onClose }: { title: string; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold leading-snug">{title}</span>
        {sub && <span className="text-[13px] text-muted">{sub}</span>}
      </div>
      <IconBtn label="Tutup" onClick={onClose}>
        <X size={16} />
      </IconBtn>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return (
    <>
      <div onClick={onClose} className={cx("fixed inset-0 z-30 bg-[rgba(13,23,38,.3)] transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")} />
      <aside
        aria-hidden={!open}
        className={cx(
          "fixed inset-y-0 right-0 z-[31] flex w-[460px] max-w-full flex-col border-l border-line bg-card shadow-pop transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.9,.25,1)]",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="text-[15px] font-semibold">{title}</span>
          <IconBtn label="Tutup" onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3.5">{footer}</div>}
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ verifikasi (Lokasi / Wajah)

export function VerifMark({ ok, label, tip }: { ok: boolean; label: string; tip?: string }) {
  return (
    <span title={tip} className={cx("inline-flex cursor-help items-center gap-1 text-xs font-medium", ok ? "text-ok" : "text-bad")}>
      {ok ? <Check size={13} strokeWidth={2.6} /> : <X size={13} strokeWidth={2.6} />}
      {label}
    </span>
  );
}
