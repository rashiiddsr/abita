import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DAY3, MONTHS, addDays, fmtDate, fmtRange, parseDate } from "@/lib/format";
import { PillTabs } from "./pill-tabs";
import { Button, cx } from "./ui";

export type DateRange = { from: string | null; to: string };

/** Pemilih rentang tanggal: klik tanggal mulai lalu tanggal selesai (tidak bisa melewati hari ini). */
export function DateRangePicker({ value, max, onChange, label }: { value: DateRange; max: string; onChange: (r: DateRange) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ a: string; b: string | null } | null>(null);
  const [month, setMonth] = useState((value.to ?? max).slice(0, 7));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const [y, m] = month.split("-").map(Number);
  const first = parseDate(`${month}-01`);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Senin di kolom pertama
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const a = draft?.a ?? value.from;
  const b = draft ? draft.b : value.to;
  const lo = a && b && a > b ? b : a;
  const hi = a && b && a > b ? a : b;

  function pick(iso: string) {
    if (!draft || draft.b) setDraft({ a: iso, b: null });
    else {
      const [from, to] = draft.a <= iso ? [draft.a, iso] : [iso, draft.a];
      setDraft(null);
      setOpen(false);
      onChange({ from, to });
    }
  }

  const text = label ?? (value.from ? fmtRange(value.from, value.to) : `Semua s.d. ${fmtDate(value.to)}`);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen(!open);
          setDraft(null);
          setMonth((value.to ?? max).slice(0, 7));
        }}
        className="flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-field px-3 text-[13px] font-medium text-ink hover:bg-soft"
      >
        <Calendar size={15} className="text-muted" />
        <span className="tnum">{text}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-[280px] rounded-xl bg-card p-3 shadow-pop">
          <div className="mb-2 flex items-center justify-between">
            <button aria-label="Bulan sebelumnya" onClick={() => shift(-1)} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-soft">
              <ChevronLeft size={16} />
            </button>
            <span className="text-[13px] font-medium">
              {MONTHS[m - 1]} {y}
            </span>
            <button aria-label="Bulan berikutnya" disabled={month >= max.slice(0, 7)} onClick={() => shift(1)} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-soft disabled:opacity-30">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-0.5 text-center">
            {[1, 2, 3, 4, 5, 6, 0].map((i) => (
              <span key={i} className="pb-1 text-[11px] font-medium text-faint">
                {DAY3[i]}
              </span>
            ))}
            {[...Array(lead)].map((_, i) => (
              <span key={`e${i}`} />
            ))}
            {[...Array(nDays)].map((_, i) => {
              const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
              const future = iso > max;
              const edge = iso === lo || iso === hi;
              const inside = !!lo && !!hi && iso > lo && iso < hi;
              return (
                <button
                  key={iso}
                  disabled={future}
                  onClick={() => pick(iso)}
                  className={cx(
                    "tnum h-8 text-[13px] disabled:text-off",
                    edge ? "rounded-md bg-brand font-medium text-white" : inside ? "bg-brand-soft text-ink" : "rounded-md text-ink hover:bg-soft",
                    iso === max && !edge && "font-semibold text-brand",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-xs text-muted">
            <span>{draft && !draft.b ? "Pilih tanggal selesai" : "Pilih tanggal mulai"}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setOpen(false);
                onChange({ from: max, to: max });
              }}
            >
              Hari ini
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export type Preset = "today" | "7d" | "30d" | "month" | "all";

export function presetRange(p: Preset, today: string): DateRange {
  if (p === "today") return { from: today, to: today };
  if (p === "7d") return { from: addDays(today, -6), to: today };
  if (p === "30d") return { from: addDays(today, -29), to: today };
  if (p === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: null, to: today };
}

export function presetOf(r: DateRange, today: string): Preset | null {
  for (const p of ["today", "7d", "30d", "month", "all"] as Preset[]) {
    const x = presetRange(p, today);
    if (x.from === r.from && x.to === r.to) return p;
  }
  return null;
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Hari ini" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "month", label: "Bulan ini" },
  { value: "all", label: "Semua" },
];

/** Filter waktu di kanan baris kontrol: preset (pill tab) + pemilih rentang tanggal. */
export function DateFilter({ value, today, onChange, label }: { value: DateRange; today: string; onChange: (r: DateRange) => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PillTabs label="Rentang tanggal" value={presetOf(value, today)} tabs={PRESETS} onChange={(p) => onChange(presetRange(p, today))} />
      <DateRangePicker value={value} max={today} onChange={onChange} label={label} />
    </div>
  );
}
