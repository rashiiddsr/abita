/** Form pengajuan (lembar dari bawah): izin/sakit dengan lampiran SKD, dan tukar shift dengan rekan satu unit. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CalendarRange, Camera, CheckCircle2, Circle, FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "../lib/api";
import { addDays, BULAN, diffDays, fmtDayShort, fmtWeekday3, shiftRange, todayWib } from "../lib/format";
import { useConfig } from "../lib/session";
import type { ShiftDay, ShiftType, SwapCandidate } from "../lib/types";
import { Card, cx, Field, inputCls, PrimaryButton, SecondaryButton, Segmented, Sheet, Spinner } from "./ui";

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["leaves", "swaps", "me", "shifts", "upcoming"]) qc.invalidateQueries({ queryKey: [k] });
}

export function shiftColor(t: ShiftType) {
  return t.color && /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : "var(--muted)";
}

export function ShiftChip({ t }: { t: ShiftType }) {
  const c = shiftColor(t);
  return (
    <span className="inline-flex rounded-[8px] px-2.5 py-1 text-[12.5px] font-bold" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {t.name} {shiftRange(t)}
    </span>
  );
}

// ==================================================================== izin / sakit

export function LeaveForm({ kind, open, onClose, onSent }: { kind: "izin" | "sakit"; open: boolean; onClose: () => void; onSent: () => void }) {
  const qc = useQueryClient();
  const cfg = useConfig();
  const today = todayWib();
  const sakit = kind === "sakit";
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const maxMb = cfg.data?.max_attachment_mb ?? 8;
  const minStart = sakit ? addDays(today, -7) : today;

  useEffect(() => {
    if (open) {
      setStart(today);
      setEnd(today);
      setReason("");
      setFile(null);
      setError(null);
    }
  }, [open, today]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) return setError(`Ukuran file maksimal ${maxMb} MB.`);
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) return setError("Lampiran harus foto (JPG/PNG/WEBP) atau PDF.");
    setFile(f);
    setError(null);
  };

  async function submit() {
    if (reason.trim().length < 3) return setError("Tuliskan catatan pengajuan.");
    if (sakit && !file) return setError("Lampirkan Surat Keterangan Dokter (SKD).");
    if (end < start) return setError("Tanggal selesai tidak boleh sebelum tanggal mulai.");
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("start_date", start);
      fd.append("end_date", end);
      fd.append("reason", reason.trim());
      if (sakit && file) fd.append("attachment", file, file.name || "skd.jpg");
      await api("/me/leaves", { body: fd });
      invalidate(qc);
      onSent();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={sakit ? "Ajukan sakit" : "Ajukan izin"}>
      <div className="flex flex-col gap-4 pt-2">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Mulai">
            <input type="date" value={start} min={minStart} max={addDays(today, 120)} onChange={(e) => (setStart(e.target.value), e.target.value > end && setEnd(e.target.value))} className={cx(inputCls, "tnum px-3")} />
          </Field>
          <Field label="Sampai">
            <input type="date" value={end} min={start} max={addDays(today, 120)} onChange={(e) => setEnd(e.target.value)} className={cx(inputCls, "tnum px-3")} />
          </Field>
        </div>
        <span className="-mt-2 px-0.5 text-[12px] text-faint">{Math.max(1, diffDays(end, start) + 1)} hari</span>
        <Field label="Catatan">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={sakit ? "Demam tinggi, radang tenggorokan" : "Menghadiri ujian seminar proposal"} className={cx(inputCls, "h-auto py-3 leading-snug")} />
        </Field>
        {sakit ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-muted">Surat Keterangan Dokter</span>
            {file ? (
              <div className="flex items-center gap-2.5 rounded-[14px] bg-ok-bg py-1.5 pl-3.5 pr-1.5">
                {file.type === "application/pdf" ? <FileText size={19} className="text-ok" /> : <ImageIcon size={19} className="text-ok" />}
                <span className="flex-1 truncate text-[14px] font-semibold">{file.name || "Foto SKD"}</span>
                <button type="button" aria-label="Hapus" onClick={() => setFile(null)} className="flex size-9 items-center justify-center rounded-full">
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <SecondaryButton icon={<Camera size={17} />} onClick={() => camRef.current?.click()}>
                  Foto
                </SecondaryButton>
                <SecondaryButton icon={<Paperclip size={17} />} onClick={() => fileRef.current?.click()}>
                  Pilih file
                </SecondaryButton>
              </div>
            )}
            {/* SKD = dokumen. Tidak pernah dipakai untuk verifikasi wajah. */}
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <span className="px-0.5 text-[12px] text-faint">Foto atau PDF, maks. {maxMb} MB</span>
          </div>
        ) : null}
        {error && <span className="text-[14px] font-semibold text-bad">{error}</span>}
        <PrimaryButton data-submit loading={busy} onClick={submit}>
          Kirim pengajuan
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

// ==================================================================== tukar shift

/** Tukar dengan rekan satu unit: shift saya pada `date` <-> shift rekan pada tanggal tujuan (sama / beda tanggal). */
export function SwapForm({ open, onClose, onSent, initialDate }: { open: boolean; onClose: () => void; onSent: () => void; initialDate?: string }) {
  const qc = useQueryClient();
  const today = todayWib();
  const last = addDays(today, 45);
  const mineQ = useQuery({ queryKey: ["shifts", "swap", today], enabled: open, queryFn: () => api<ShiftDay[]>("/me/shifts", { query: { from: today, to: last } }) });
  const mine = new Map((mineQ.data ?? []).map((s) => [s.date, s]));
  const [date, setDate] = useState<string | null>(null);
  const [mode, setMode] = useState<"same" | "diff">("same");
  const [other, setOther] = useState<string | null>(null);
  const [pickId, setPickId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("same");
    setOther(null);
    setPickId(null);
    setReason("");
    setError(null);
  }, [open]);
  useEffect(() => {
    if (!open || !mineQ.data) return;
    const work = mineQ.data.filter((s) => !s.pending_swap).map((s) => s.date);
    setDate((d) => d ?? (initialDate && mine.has(initialDate) ? initialDate : (work[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mineQ.data]);

  const ready = !!date && (mode === "same" || !!other);
  const cands = useQuery({
    queryKey: ["swap-candidates", date, mode, other],
    enabled: open && ready,
    retry: false,
    queryFn: () => api<SwapCandidate[]>("/me/swap-candidates", { query: { date: date!, target_date: mode === "diff" ? other! : undefined } }),
  });
  const picked = cands.data?.find((c) => c.user_id === pickId) ?? null;
  const myShift = date ? mine.get(date) : undefined;

  async function submit() {
    if (!date) return setError("Pilih tanggal shift Anda.");
    if (mode === "diff" && !other) return setError("Pilih tanggal shift rekan.");
    if (!pickId) return setError("Pilih rekan yang diajak tukar.");
    if (reason.trim().length < 3) return setError("Tuliskan catatan tukar shift.");
    setBusy(true);
    setError(null);
    try {
      await api("/me/swaps", { body: { date, target_user_id: pickId, target_date: mode === "diff" ? other : null, reason: reason.trim() } });
      invalidate(qc);
      onSent();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const workDays = (mineQ.data ?? []).map((s) => s.date);
  return (
    <Sheet open={open} onClose={onClose} title="Tukar shift">
      <div className="flex flex-col gap-4 pt-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-muted">Shift Anda</span>
          {mineQ.isPending ? (
            <Spinner size={22} />
          ) : !workDays.length ? (
            <span className="text-[14px] text-muted">Belum ada jadwal terbit dalam 45 hari ke depan.</span>
          ) : (
            <>
              {/* geser horizontal: daftar 45 hari terlalu panjang untuk dropdown */}
              <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {workDays.map((d) => {
                  const s = mine.get(d)!;
                  const on = d === date;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={s.pending_swap}
                      onClick={() => (setDate(d), setPickId(null), other === d && setOther(null))}
                      aria-pressed={on}
                      title={s.pending_swap ? "Tukar sudah diajukan" : undefined}
                      className={cx(
                        "flex w-[62px] shrink-0 flex-col items-center gap-0.5 rounded-[14px] border py-2 transition active:scale-95 disabled:opacity-40",
                        on ? "border-brand bg-brand text-white" : "border-line bg-card text-ink",
                      )}
                    >
                      <span className={cx("text-[11px] font-semibold", on ? "text-white/80" : "text-muted")}>{fmtWeekday3(d)}</span>
                      <span className="font-display tnum text-[20px] font-bold leading-tight">{Number(d.slice(8))}</span>
                      <span className={cx("text-[11px]", on ? "text-white/80" : "text-muted")}>{BULAN[Number(d.slice(5, 7)) - 1].slice(0, 3)}</span>
                      <span className={cx("max-w-full truncate px-1 text-[11px] font-bold", on ? "text-white" : "text-brand")}>{s.shift.name}</span>
                    </button>
                  );
                })}
              </div>
              {myShift && (
                <span>
                  <ShiftChip t={myShift.shift} />
                </span>
              )}
            </>
          )}
        </div>
        <Segmented
          value={mode}
          onChange={(v) => (setMode(v), setOther(null), setPickId(null))}
          items={[
            { value: "same", label: "Tanggal sama", icon: <Calendar size={16} /> },
            { value: "diff", label: "Beda tanggal", icon: <CalendarRange size={16} /> },
          ]}
        />
        {mode === "diff" && (
          <Field label="Tanggal shift rekan (Anda libur)">
            <input
              type="date"
              value={other ?? ""}
              min={today}
              max={last}
              onChange={(e) => {
                const v = e.target.value;
                if (mine.has(v) || v === date) return setError("Pilih tanggal saat Anda libur.");
                setError(null);
                setOther(v);
                setPickId(null);
              }}
              className={cx(inputCls, "tnum")}
            />
          </Field>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-muted">Rekan satu unit</span>
          {!ready ? (
            <span className="text-[14px] text-faint">Pilih tanggal shift rekan.</span>
          ) : cands.isPending ? (
            <div className="flex justify-center p-3">
              <Spinner size={22} />
            </div>
          ) : cands.isError ? (
            <span className="text-[14px] text-bad">{errMsg(cands.error)}</span>
          ) : !cands.data.length ? (
            <span className="text-[14px] text-muted">Tidak ada rekan yang bisa diajak tukar pada tanggal ini.</span>
          ) : (
            <Card pad={false} className="divide-y divide-line overflow-hidden border border-line">
              {cands.data.map((c) => (
                <button key={c.user_id} type="button" onClick={() => setPickId(c.user_id)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-soft">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[14.5px] font-semibold">{c.name}</span>
                    <span>
                      <ShiftChip t={c.shift} />
                    </span>
                  </span>
                  {pickId === c.user_id ? <CheckCircle2 size={21} className="text-brand" /> : <Circle size={21} className="text-faint" />}
                </button>
              ))}
            </Card>
          )}
        </div>
        {picked && myShift && date && (
          <div className="whitespace-pre-line rounded-[14px] bg-soft p-3 text-[14px] leading-relaxed">
            {mode === "same"
              ? `${fmtDayShort(date)}: Anda ${picked.shift.name}, ${picked.name} ${myShift.shift.name}`
              : `${fmtDayShort(date)}: ${picked.name} ${myShift.shift.name}\n${fmtDayShort(other!)}: Anda ${picked.shift.name}`}
          </div>
        )}
        <Field label="Catatan">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Mengikuti seminar sertifikasi" className={cx(inputCls, "h-auto py-3 leading-snug")} />
        </Field>
        {error && <span className="text-[14px] font-semibold text-bad">{error}</span>}
        <PrimaryButton data-submit loading={busy} onClick={submit}>
          Kirim pengajuan
        </PrimaryButton>
      </div>
    </Sheet>
  );
}
