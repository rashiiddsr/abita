import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { shiftTone, toneStyle } from "@/lib/status";
import type { ShiftType } from "@/lib/types";
import { Select, cx } from "./ui";

/** Ringkas urutan pola untuk daftar: "P P S S M M L L". */
export function SequenceChips({ sequence, types, className }: { sequence: (number | null)[]; types: ShiftType[]; className?: string }) {
  const byId = new Map(types.map((t) => [t.id, t]));
  return (
    <span className={cx("flex flex-wrap gap-1", className)}>
      {sequence.map((id, i) => {
        const t = id == null ? null : byId.get(id);
        const c = t ? shiftTone(t.name, t.color) : null;
        return (
          <span
            key={i}
            title={t ? `${t.name} ${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}` : "Libur"}
            className={cx("flex size-6 items-center justify-center rounded-md text-[11px] font-semibold", !c && "border border-line text-faint")}
            style={c ? toneStyle(c.bg, c.fg) : undefined}
          >
            {c ? c.code : "L"}
          </span>
        );
      })}
    </span>
  );
}

/** Urutan shift per hari (Hari 1, Hari 2, …) dengan tambah, hapus, dan geser urutan. */
export function SequenceEditor({ value, onChange, types }: { value: (number | null)[]; onChange: (v: (number | null)[]) => void; types: ShiftType[] }) {
  const opts = [...types.map((t) => ({ value: String(t.id), label: `${t.name} (${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)})` })), { value: "", label: "Libur" }];
  const set = (i: number, v: number | null) => onChange(value.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: number) => {
    const n = [...value];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    onChange(n);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((id, i) => {
        const t = types.find((x) => x.id === id);
        const c = t ? shiftTone(t.name, t.color) : null;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="tnum w-14 flex-none text-[12.5px] text-muted">Hari {i + 1}</span>
            <span className={cx("flex size-7 flex-none items-center justify-center rounded-md text-[11.5px] font-semibold", !c && "border border-line text-faint")} style={c ? toneStyle(c.bg, c.fg) : undefined}>
              {c ? c.code : "L"}
            </span>
            <Select className="min-w-0 flex-1" value={id == null ? "" : String(id)} onChange={(v) => set(i, v ? Number(v) : null)} options={opts} />
            <button aria-label="Naikkan" disabled={i === 0} onClick={() => move(i, -1)} className="flex size-8 flex-none items-center justify-center rounded-md text-muted hover:bg-soft disabled:opacity-30">
              <ArrowUp size={15} />
            </button>
            <button aria-label="Turunkan" disabled={i === value.length - 1} onClick={() => move(i, 1)} className="flex size-8 flex-none items-center justify-center rounded-md text-muted hover:bg-soft disabled:opacity-30">
              <ArrowDown size={15} />
            </button>
            <button aria-label="Hapus hari" disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))} className="flex size-8 flex-none items-center justify-center rounded-md text-muted hover:bg-bad-bg hover:text-bad disabled:opacity-30">
              <X size={15} />
            </button>
          </div>
        );
      })}
      <button onClick={() => onChange([...value, value[value.length - 1] ?? types[0]?.id ?? null])} className="flex h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-brand hover:bg-brand-soft">
        <Plus size={15} /> Tambah hari
      </button>
    </div>
  );
}
