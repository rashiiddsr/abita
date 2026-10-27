/** Daftar pengajuan (izin, sakit, tukar shift) + permintaan tukar dari rekan + detail & aksi. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Info, Paperclip, Plus, Repeat2, RotateCcw, SlidersHorizontal, Thermometer, X } from "lucide-react";
import { useMemo, useState } from "react";
import { LeaveForm, SwapForm } from "../components/forms";
import { Card, ConfirmSheet, Empty, FilterPill, IconTile, ListRow, Pill, PrimaryButton, RoundButton, SecondaryButton, SectionLabel, Sheet, Skel, Title, useToast } from "../components/ui";
import { api, errMsg, fileUrl } from "../lib/api";
import { diffDays, fmtDateMed, fmtDateTime, fmtDayShort, fmtMonth, shiftRange, todayWib } from "../lib/format";
import type { Leave, ShiftType, Swap } from "../lib/types";

type Req = { kind: "izin" | "sakit" | "tukar"; status: string; date: string; created: string; leave?: Leave; swap?: Swap };
const STATUS: Record<string, string> = { semua: "Semua", pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak", cancelled: "Dibatalkan" };
const PERIOD: Record<string, string> = { semua: "Semua", bulan_ini: "Bulan ini", "3_bulan": "3 bulan terakhir", "6_bulan": "6 bulan terakhir", tahun_ini: "Tahun ini" };
const PAGE = 15;

const kindStyle = (k: string) =>
  k === "sakit"
    ? { icon: <Thermometer size={18} />, tone: "bad" as const, label: "Sakit" }
    : k === "tukar"
      ? { icon: <Repeat2 size={18} />, tone: "warn" as const, label: "Tukar shift" }
      : { icon: <FileText size={18} />, tone: "purple" as const, label: "Izin" };

export function StatusPill({ status }: { status: string }) {
  if (status === "approved") return <Pill tone="ok">Disetujui</Pill>;
  if (status === "rejected") return <Pill tone="bad">Ditolak</Pill>;
  if (status === "cancelled") return <Pill>Dibatalkan</Pill>;
  return <Pill tone="warn">Menunggu</Pill>;
}
export function SwapPill({ s }: { s: Swap }) {
  if (s.stage === "peer") return s.can_respond ? <Pill tone="brand">Perlu jawaban</Pill> : <Pill>Menunggu rekan</Pill>;
  if (s.stage === "review") return <Pill tone="warn">Menunggu KA</Pill>;
  return <StatusPill status={s.status} />;
}
const days = (l: Leave) => diffDays(l.end_date, l.start_date) + 1;

export function RequestsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const leaves = useQuery({ queryKey: ["leaves"], queryFn: () => api<Leave[]>("/me/leaves") });
  const swaps = useQuery({ queryKey: ["swaps"], queryFn: () => api<Swap[]>("/me/swaps") });
  const [kind, setKind] = useState("semua");
  const [status, setStatus] = useState("semua");
  const [period, setPeriod] = useState("semua");
  const [shown, setShown] = useState(PAGE);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<"izin" | "sakit" | "tukar" | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<Req | null>(null);

  const all = useMemo<Req[] | null>(() => {
    if (!leaves.data || !swaps.data) return null;
    return [
      ...leaves.data.map((l) => ({ kind: l.kind, status: l.status, date: l.start_date, created: l.created_at, leave: l })),
      ...swaps.data.map((s) => ({ kind: "tukar" as const, status: s.status, date: s.date, created: s.created_at, swap: s })),
    ].sort((a, b) => b.created.localeCompare(a.created));
  }, [leaves.data, swaps.data]);

  const today = todayWib();
  const inPeriod = (d: string) => {
    const [y, m] = today.split("-").map(Number);
    const ym = (n: number) => {
      const t = new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
      return `${t}-01`;
    };
    if (period === "bulan_ini") return d.slice(0, 7) === today.slice(0, 7);
    if (period === "3_bulan") return d >= ym(2);
    if (period === "6_bulan") return d >= ym(5);
    if (period === "tahun_ini") return d.slice(0, 4) === today.slice(0, 4);
    return true;
  };
  const filtered = (all ?? []).filter((r) => (kind === "semua" || r.kind === kind) && (status === "semua" || r.status === status) && inPeriod(r.date));
  const visible = filtered.slice(0, shown);
  const groups = new Map<string, Req[]>();
  for (const r of visible) groups.set(r.created.slice(0, 7), [...(groups.get(r.created.slice(0, 7)) ?? []), r]);
  const incoming = (all ?? []).filter((r) => r.swap?.can_respond);
  const pending = (all ?? []).filter((r) => r.status === "pending").length;
  const activeFilters = Number(status !== "semua") + Number(period !== "semua");
  const changed = () => {
    for (const k of ["leaves", "swaps", "me", "shifts", "upcoming"]) qc.invalidateQueries({ queryKey: [k] });
  };

  return (
    <div className="animate-page px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <div className="flex items-center gap-2">
        <Title className="flex-1">Pengajuan</Title>
        <RoundButton label="Filter" onClick={() => setFilterOpen(true)} badge={activeFilters || undefined}>
          <SlidersHorizontal size={18} />
        </RoundButton>
        <button type="button" onClick={() => setNewOpen(true)} className="flex h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-[14px] font-bold text-white active:scale-95">
          <Plus size={17} /> Ajukan
        </button>
      </div>
      {pending > 0 && <p className="mt-1 text-[13px] text-muted">{pending} menunggu persetujuan</p>}
      {incoming.map((r) => (
        <Incoming key={r.swap!.id} s={r.swap!} onDone={changed} />
      ))}
      <div className="mt-3 flex items-start gap-3 rounded-[18px] border border-line bg-card p-3.5">
        <Info size={18} className="mt-0.5 shrink-0 text-brand" />
        <p className="text-[13px] leading-relaxed text-muted">
          <b className="text-ink">Ketentuan pengajuan.</b> Sakit wajib melampirkan Surat Keterangan Dokter (SKD). Tukar shift disetujui Kepala Unit.
        </p>
      </div>
      <div className="no-scrollbar -mx-4 mt-3.5 flex gap-2 overflow-x-auto px-4">
        {(["semua", "izin", "sakit", "tukar"] as const).map((k) => (
          <FilterPill key={k} selected={kind === k} onClick={() => (setKind(k), setShown(PAGE))}>
            {{ semua: "Semua", izin: "Izin", sakit: "Sakit", tukar: "Tukar shift" }[k]}
          </FilterPill>
        ))}
      </div>
      {activeFilters > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {status !== "semua" && <Chip label={STATUS[status]} onClear={() => setStatus("semua")} />}
          {period !== "semua" && <Chip label={PERIOD[period]} onClear={() => setPeriod("semua")} />}
        </div>
      )}
      {(leaves.isError || swaps.isError) && <p className="mt-3 text-bad">{errMsg(leaves.error ?? swaps.error)}</p>}
      {!all && !leaves.isError && !swaps.isError && <Skel className="mt-4 h-40" />}
      {all && !filtered.length && <Empty />}
      {[...groups].map(([m, rows]) => (
        <div key={m}>
          <SectionLabel>{fmtMonth(m)}</SectionLabel>
          <Card pad={false} className="divide-y divide-line overflow-hidden">
            {rows.map((r) => (
              <ReqRow key={(r.swap ? "s" : "l") + (r.swap?.id ?? r.leave!.id)} r={r} onClick={() => setDetail(r)} />
            ))}
          </Card>
        </div>
      ))}
      {filtered.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE)} className="mt-3 h-11 w-full text-[14px] font-bold text-brand">
          Tampilkan lebih banyak ({filtered.length - shown})
        </button>
      )}

      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="Ajukan">
        <div className="-mx-5 divide-y divide-line">
          <ListRow icon={<FileText size={19} />} iconTone="purple" title="Izin" onClick={() => (setNewOpen(false), setForm("izin"))} />
          <ListRow icon={<Thermometer size={19} />} iconTone="bad" title="Sakit" onClick={() => (setNewOpen(false), setForm("sakit"))} />
          <ListRow icon={<Repeat2 size={19} />} iconTone="warn" title="Tukar shift" onClick={() => (setNewOpen(false), setForm("tukar"))} />
        </div>
      </Sheet>
      <LeaveForm kind="izin" open={form === "izin"} onClose={() => setForm(null)} onSent={() => (setForm(null), toast("Pengajuan terkirim."))} />
      <LeaveForm kind="sakit" open={form === "sakit"} onClose={() => setForm(null)} onSent={() => (setForm(null), toast("Pengajuan terkirim."))} />
      <SwapForm open={form === "tukar"} onClose={() => setForm(null)} onSent={() => (setForm(null), toast("Pengajuan tukar shift terkirim."))} />
      <FilterSheet open={filterOpen} status={status} period={period} onClose={() => setFilterOpen(false)} onApply={(s, p) => (setStatus(s), setPeriod(p), setShown(PAGE), setFilterOpen(false))} />
      <Detail r={detail} onClose={() => setDetail(null)} onChanged={() => (setDetail(null), changed())} />
    </div>
  );
}

const Chip = ({ label, onClear }: { label: string; onClear: () => void }) => (
  <span className="flex items-center gap-1 rounded-full bg-brand-soft py-1 pl-3 pr-1 text-[13px] font-semibold text-brand">
    {label}
    <button type="button" aria-label="Hapus filter" onClick={onClear} className="flex size-6 items-center justify-center rounded-full">
      <X size={14} />
    </button>
  </span>
);

function ReqRow({ r, onClick }: { r: Req; onClick: () => void }) {
  const ks = kindStyle(r.kind);
  const l = r.leave,
    s = r.swap;
  const title = l
    ? `${ks.label} · ${days(l)} hari`
    : s!.target_user_id === null
      ? `${ks.label} · ${s!.from_shift?.name ?? "Libur"} → ${s!.to_shift.name}`
      : s!.direction === "in"
        ? `Tukar dari ${s!.name ?? "rekan"}`
        : `Tukar dengan ${s!.target_name ?? "rekan"}`;
  const sub = l ? (days(l) === 1 ? fmtDayShort(l.start_date) : `${fmtDayShort(l.start_date)} – ${fmtDayShort(l.end_date)}`) : s!.summary;
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-soft">
      <IconTile icon={ks.icon} tone={ks.tone} size={36} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14.5px] font-semibold">{title}</span>
        <span className="truncate text-[12.5px] text-muted">{sub}</span>
      </span>
      {s ? <SwapPill s={s} /> : <StatusPill status={r.status} />}
    </button>
  );
}

/** Permintaan tukar dari rekan: Terima / Tolak langsung dari daftar. */
function Incoming({ s, onDone }: { s: Swap; onDone: () => void }) {
  const toast = useToast();
  const [ask, setAsk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await api(`/me/swaps/${s.id}/respond`, { body: { accept } });
      toast(accept ? "Diteruskan ke Kepala Unit." : "Permintaan ditolak.");
      setAsk(null);
      onDone();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mt-3">
      <div className="flex items-center gap-3">
        <IconTile icon={<Repeat2 size={17} />} size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14.5px] font-bold">{s.name ?? "Rekan"} mengajak tukar shift</span>
          <span className="text-[12.5px] text-muted">{s.summary}</span>
        </span>
      </div>
      {s.reason && <p className="mt-2.5 text-[13.5px]">{s.reason}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <SecondaryButton disabled={busy} onClick={() => setAsk(false)}>
          Tolak
        </SecondaryButton>
        <PrimaryButton disabled={busy} onClick={() => setAsk(true)}>
          Terima
        </PrimaryButton>
      </div>
      <ConfirmSheet
        open={ask !== null}
        icon={ask ? <Repeat2 size={28} /> : <X size={28} />}
        title={ask ? "Terima tukar shift?" : "Tolak tukar shift?"}
        message={ask ? `${s.summary}\nDiteruskan ke Kepala Unit untuk disetujui.` : s.summary}
        confirm={ask ? "Terima" : "Tolak"}
        danger={ask === false}
        loading={busy}
        onConfirm={() => answer(!!ask)}
        onClose={() => setAsk(null)}
      />
    </Card>
  );
}

function FilterSheet({ open, status, period, onClose, onApply }: { open: boolean; status: string; period: string; onClose: () => void; onApply: (s: string, p: string) => void }) {
  const [s, setS] = useState(status);
  const [p, setP] = useState(period);
  return (
    <Sheet open={open} onClose={onClose} title="Filter">
      <div className="flex flex-col gap-2 pt-1">
        <button type="button" onClick={() => (setS("semua"), setP("semua"))} className="flex items-center gap-1.5 self-end text-[13px] font-bold text-muted">
          <RotateCcw size={15} /> Reset
        </button>
        <span className="text-[13px] font-semibold text-muted">Status</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS).map(([k, v]) => (
            <FilterPill key={k} selected={s === k} onClick={() => setS(k)}>
              {v}
            </FilterPill>
          ))}
        </div>
        <span className="mt-3 text-[13px] font-semibold text-muted">Periode</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PERIOD).map(([k, v]) => (
            <FilterPill key={k} selected={p === k} onClick={() => setP(k)}>
              {v}
            </FilterPill>
          ))}
        </div>
        <PrimaryButton className="mt-5" onClick={() => onApply(s, p)}>
          Terapkan
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

/** Detail satu pengajuan + aksi (jawab permintaan rekan / batalkan / lihat SKD). */
function Detail({ r, onClose, onChanged }: { r: Req | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await f();
      toast(done);
      onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  const shift = (t: ShiftType | null) => (t ? `${t.name} · ${shiftRange(t)}` : "Libur");
  const l = r?.leave,
    s = r?.swap;
  const ks = r ? kindStyle(r.kind) : null;
  const note = l?.review_note ?? s?.review_note;
  return (
    <Sheet open={!!r} onClose={onClose}>
      {r && ks && (
        <div className="pt-1">
          <div className="flex items-center gap-3">
            <IconTile icon={ks.icon} tone={ks.tone} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[12.5px] text-muted">{ks.label}</span>
              <span className="font-display text-[17px] font-bold">
                {l ? (days(l) === 1 ? fmtDateMed(l.start_date) : `${fmtDateMed(l.start_date)} – ${fmtDateMed(l.end_date)}`) : fmtDateMed(s!.date)}
              </span>
            </span>
            {s ? <SwapPill s={s} /> : <StatusPill status={r.status} />}
          </div>
          <div className="mt-3 border-t border-line pt-1">
            {l ? (
              <>
                <Row k="Durasi" v={`${days(l)} hari`} />
                <Row k="Catatan" v={l.reason} />
              </>
            ) : s!.target_user_id === null ? (
              <>
                <Row k="Shift awal" v={shift(s!.from_shift)} />
                <Row k="Ganti ke" v={shift(s!.to_shift)} />
                <Row k="Catatan" v={s!.reason} />
              </>
            ) : (
              <>
                <Row k={s!.direction === "in" ? "Pemohon" : "Rekan"} v={(s!.direction === "in" ? s!.name : s!.target_name) ?? "-"} />
                <Row k={`${s!.direction === "in" ? (s!.name ?? "Pemohon") : "Anda"} serahkan`} v={`${fmtDayShort(s!.date)} · ${shift(s!.from_shift)}`} />
                <Row k={`${s!.direction === "in" ? (s!.name ?? "Pemohon") : "Anda"} ambil`} v={`${fmtDayShort(s!.target_date ?? s!.date)} · ${shift(s!.to_shift)}`} />
                <Row k="Catatan" v={s!.reason} />
                {s!.peer_status && <Row k="Jawaban rekan" v={s!.peer_status === "accepted" ? "Menerima" : s!.peer_status === "declined" ? "Menolak" : "Belum menjawab"} />}
                {s!.peer_note && <Row k="Catatan rekan" v={s!.peer_note} />}
              </>
            )}
            <Row k="Diajukan" v={`${fmtDateTime(r.created)} WIB`} />
            {s?.reviewer_name && s.status !== "pending" && <Row k="Diputuskan" v={s.reviewer_name} />}
            {note && <Row k="Catatan" v={note} />}
          </div>
          {l?.has_attachment && (
            <SecondaryButton className="mt-3" icon={<Paperclip size={17} />} onClick={() => window.open(fileUrl(`/leaves/${l.id}/attachment`), "_blank")}>
              Lihat SKD
            </SecondaryButton>
          )}
          {s?.can_respond ? (
            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
              <SecondaryButton disabled={busy} onClick={() => run(() => api(`/me/swaps/${s.id}/respond`, { body: { accept: false } }), "Permintaan ditolak.")}>
                Tolak
              </SecondaryButton>
              <PrimaryButton loading={busy} onClick={() => run(() => api(`/me/swaps/${s.id}/respond`, { body: { accept: true } }), "Diteruskan ke Kepala Unit.")}>
                Terima
              </PrimaryButton>
            </div>
          ) : s && s.direction === "out" && s.status === "pending" ? (
            <SecondaryButton className="mt-3.5" icon={<X size={17} />} loading={busy} onClick={() => run(() => api(`/me/swaps/${s.id}/cancel`, { method: "POST" }), "Pengajuan dibatalkan.")}>
              Batalkan pengajuan
            </SecondaryButton>
          ) : l && (l.status === "pending" || (l.status === "approved" && l.start_date > todayWib())) ? (
            <SecondaryButton className="mt-3.5" icon={<X size={17} />} loading={busy} onClick={() => run(() => api(`/me/leaves/${l.id}/cancel`, { method: "POST" }), "Pengajuan dibatalkan.")}>
              Batalkan pengajuan
            </SecondaryButton>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/** Baris label-nilai di detail pengajuan. */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 py-2.5">
      <span className="w-[112px] shrink-0 text-[14px] text-muted">{k}</span>
      <span className="flex-1 text-[14px] font-semibold">{v}</span>
    </div>
  );
}
