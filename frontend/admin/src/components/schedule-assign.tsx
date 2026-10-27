import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import type { BulkResult, SchedulePattern, ShiftType, User } from "@/lib/types";
import { PillTabs } from "./pill-tabs";
import { useToast } from "./providers";
import { SequenceChips, SequenceEditor } from "./sequence-editor";
import { Button, Checkbox, Drawer, FormRow, Select, cx, inputCls, Empty } from "./ui";

/**
 * Panel "Atur jadwal": terapkan pola jadwal (dari Admin SDM) atau urutan shift khusus ke karyawan
 * mulai tanggal efektif, berulang tanpa akhir atau sampai tanggal tertentu.
 */
export function AssignDrawer({
  open,
  people,
  initial,
  range,
  types,
  today,
  onClose,
}: {
  open: boolean;
  people: User[];
  initial: number[];
  /** sel terpilih di kalender: isi awal Mulai / Sampai tanggal */
  range?: { from: string; to: string } | null;
  types: ShiftType[];
  today: string;
  onClose: () => void;
}) {
  return (
    <Drawer open={open} onClose={onClose} title="Atur jadwal">
      {open && <AssignBody key={initial.join(",")} people={people} initial={initial} range={range ?? null} types={types} today={today} onClose={onClose} />}
    </Drawer>
  );
}

function AssignBody({
  people,
  initial,
  range,
  types,
  today,
  onClose,
}: {
  people: User[];
  initial: number[];
  range: { from: string; to: string } | null;
  types: ShiftType[];
  today: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const patterns = useQuery({ queryKey: ["patterns"], queryFn: () => api<SchedulePattern[]>("/api/v1/admin/patterns") });
  const active = (patterns.data ?? []).filter((p) => p.active);
  const [ids, setIds] = useState<number[]>(initial);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"pola" | "manual">("pola");
  const [pid, setPid] = useState<string>("");
  const [seq, setSeq] = useState<(number | null)[]>([types[0]?.id ?? null]);
  const [start, setStart] = useState(range?.from ?? today);
  const [repeat, setRepeat] = useState<"never" | "until">(range ? "until" : "never");
  const [end, setEnd] = useState(range?.to ?? "");
  const [skipHol, setSkipHol] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = active.find((p) => String(p.id) === pid) ?? null;

  const save = useMutation({
    mutationFn: () =>
      api<BulkResult>("/api/v1/admin/schedule/assign", {
        body: {
          user_ids: ids,
          pattern_id: mode === "pola" ? Number(pid) : null,
          sequence: mode === "manual" ? seq : null,
          start_date: start,
          end_date: repeat === "until" ? end : null,
          skip_holidays: skipHol,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedule-index"] });
      toast(r.skipped ? `${r.updated} sel diperbarui · ${r.skipped} dilewati (shift hari ini sudah mulai, ada absensi, atau izin)` : `${r.updated} sel diperbarui`);
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (!ids.length) return setErr("Pilih minimal satu karyawan.");
    if (mode === "pola" && !chosen) return setErr("Pilih pola jadwal.");
    if (mode === "manual" && seq.every((x) => x == null)) return setErr("Urutan harus memuat minimal satu shift.");
    if (!start || start < today) return setErr("Tanggal mulai tidak boleh sebelum hari ini.");
    if (repeat === "until" && (!end || end < start)) return setErr("Tanggal akhir harus setelah tanggal mulai.");
    setErr(null);
    save.mutate();
  }

  const k = q.trim().toLowerCase();
  const picks = people.filter((p) => !ids.includes(p.id) && (!k || p.name.toLowerCase().includes(k) || p.employee_code.toLowerCase().includes(k)));
  return (
    <div className="flex flex-col gap-4">
      <FormRow label={`Karyawan · ${ids.length} dipilih`} required>
        <div className="flex flex-col gap-2">
          {ids.length > 0 && (
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {ids.map((id) => {
                const p = people.find((x) => x.id === id);
                return (
                  <span key={id} className="flex h-7 items-center gap-1 rounded-md bg-soft pl-2 pr-1 text-[12.5px] font-medium">
                    {p?.name ?? id}
                    <button aria-label="Hapus" onClick={() => setIds(ids.filter((x) => x !== id))} className="flex size-5 items-center justify-center rounded text-muted hover:text-ink">
                      <X size={13} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari karyawan" className={cx(inputCls, "pl-9")} />
          </div>
          {(k || ids.length === 0) && (
            <div className="flex max-h-44 flex-col overflow-y-auto rounded-lg border border-line">
              {picks.length > 0 && !k && (
                <button onClick={() => setIds(people.map((p) => p.id))} className="border-b border-line2 px-3 py-2 text-left text-[13px] font-medium text-brand hover:bg-soft">
                  Pilih semua ({people.length})
                </button>
              )}
              {picks.slice(0, 50).map((p) => (
                <button key={p.id} onClick={() => setIds([...ids, p.id])} className="flex items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-soft">
                  <span className="truncate">{p.name}</span>
                  <span className="tnum text-xs text-faint">{p.employee_code}</span>
                </button>
              ))}
              {picks.length === 0 && <Empty compact />}
            </div>
          )}
        </div>
      </FormRow>

      <PillTabs
        label="Sumber jadwal"
        value={mode}
        onChange={setMode}
        tabs={[
          { value: "pola", label: "Pola jadwal" },
          { value: "manual", label: "Atur manual" },
        ]}
      />
      {mode === "pola" ? (
        <FormRow label="Pola" required>
          <div className="flex flex-col gap-2">
            <Select big value={pid} onChange={setPid} options={[{ value: "", label: active.length ? "Pilih pola" : "Belum ada pola" }, ...active.map((p) => ({ value: String(p.id), label: `${p.name} · ${p.sequence.length} hari${p.unit ? "" : " · SDM"}` }))]} />
            {chosen && <SequenceChips sequence={chosen.sequence} types={types} />}
          </div>
        </FormRow>
      ) : (
        <FormRow label={`Urutan · ${seq.length} hari, lalu berulang`} required>
          <SequenceEditor value={seq} onChange={setSeq} types={types.filter((t) => t.active)} />
        </FormRow>
      )}

      <FormRow label="Mulai" required>
        <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
      </FormRow>
      <FormRow label="Berulang">
        <div className="flex flex-col gap-2">
          <PillTabs
            label="Berulang"
            value={repeat}
            onChange={setRepeat}
            tabs={[
              { value: "never", label: "Tanpa akhir" },
              { value: "until", label: "Sampai tanggal" },
            ]}
          />
          {repeat === "until" && <input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />}
        </div>
      </FormRow>
      <Checkbox on={skipHol} onChange={() => setSkipHol(!skipHol)}>
        Libur di hari libur nasional
      </Checkbox>
      <span className="text-[12.5px] text-muted">
        {repeat === "until"
          ? "Hanya tanggal di rentang ini yang diisi; jadwal sebelum dan sesudahnya tetap. Cocok untuk mengisi hari yang terlewat."
          : "Jadwal mulai tanggal ini diganti seterusnya."}{" "}
        Tanggal yang sudah ada absensi atau izin, dan shift hari ini yang sudah mulai, tidak diubah.
      </span>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={save.isPending} onClick={submit}>
          Simpan
        </Button>
      </div>
    </div>
  );
}
