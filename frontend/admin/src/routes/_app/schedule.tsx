import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Copy, Download, Send, Upload, X } from "lucide-react";
import { useSearchParams } from "@/lib/nav";
import { Suspense, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ImportModal, ImportSummary } from "@/components/import-modal";
import { PillTabs } from "@/components/pill-tabs";
import { useToast } from "@/components/providers";
import { AssignDrawer } from "@/components/schedule-assign";
import { ScheduleIndex } from "@/components/schedule-index";
import { Page } from "@/components/shell";
import { Button, Card, Empty, ErrorState, LockedScope, Modal, ModalHead, PageHeader, Select, Skel, cx } from "@/components/ui";
import { api, download, errMsg } from "@/lib/api";
import { DAY3, MONTHS, addDays, fmtDate, fmtRange, parseDate, todayWib } from "@/lib/format";
import { useMounted, useSession } from "@/lib/session";
import { shiftTone, toneStyle } from "@/lib/status";
import type { BulkResult, Holiday, ScheduleMonth, ShiftDay, ShiftType, User } from "@/lib/types";

export const Route = createFileRoute("/_app/schedule")({ component: JadwalPage });

const hhmm = (t: string) => t.slice(0, 5);
const ym = (iso: string) => iso.slice(0, 7);
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthDays = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [...Array(n)].map((_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
};
const label = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const key = (uid: number, d: string) => `${uid}|${d}`;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const monday = (iso: string) => addDays(iso, -((parseDate(iso).getUTCDay() + 6) % 7));

type Item = { user_id: number; date: string; shift_type_id: number | null };

/** Aturan sederhana penyusunan jadwal: istirahat antar-shift, hari kerja berturut-turut, karyawan tanpa shift. */
function warningsFor(days: string[], at: (d: string) => ShiftType | null): string[] {
  const out: string[] = [];
  let run = 0;
  let runStart = "";
  let total = 0;
  days.forEach((d, i) => {
    const t = at(d);
    if (t) {
      total++;
      if (run === 0) runStart = d;
      run++;
      if (run === 7) out.push(`7+ hari kerja berturut-turut mulai ${fmtDate(runStart)}`);
      const next = i + 1 < days.length ? at(days[i + 1]) : null;
      if (next) {
        const end = minutes(t.end_time) + (minutes(t.end_time) <= minutes(t.start_time) ? 1440 : 0);
        const gap = 1440 + minutes(next.start_time) - end;
        if (gap < 8 * 60) out.push(`Istirahat ${Math.max(0, Math.round(gap / 60))} jam: ${t.name} ${fmtDate(d)} → ${next.name}`);
      }
    } else run = 0;
  });
  if (total === 0) out.push("Belum ada shift bulan ini");
  return out;
}

function JadwalPage() {
  return (
    <Suspense fallback={<Page><Skel className="h-96 rounded-xl" /></Page>}>
      <JadwalFromUrl />
    </Suspense>
  );
}

function JadwalFromUrl() {
  const sp = useSearchParams();
  const today = useMounted(() => todayWib());
  if (!today) return <Page><Skel className="h-96 rounded-xl" /></Page>;
  const m = sp.get("month");
  return <Planner key={m ?? ""} today={today} initMonth={m && /^\d{4}-\d{2}$/.test(m) ? m : ym(today)} />;
}

function Planner({ today, initMonth }: { today: string; initMonth: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(initMonth);
  const [picked, setUnitSel] = useState<string | null>(null);
  const unitSel = picked ?? [...s.units].sort((a, b) => b.staff_count - a.staff_count)[0]?.name ?? null;
  const unit = s.lockedUnit ?? unitSel;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<{ r: number; c: number } | null>(null);
  const dragging = useRef(false);
  const [modal, setModal] = useState<"publish" | "copy" | null>(null);
  const [tab, setTab] = useState<"kalender" | "daftar">("kalender");
  const [view, setView] = useState<"bulan" | "minggu">("bulan");
  const [week, setWeek] = useState(() => monday(ym(today) === initMonth ? today : `${initMonth}-01`));
  const [assign, setAssign] = useState<number[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const days = useMemo(() => (view === "bulan" ? monthDays(month) : [...Array(7)].map((_, i) => addDays(week, i))), [view, month, week]);
  const from = days[0];
  const to = days[days.length - 1];
  const types = useQuery({ queryKey: ["shift-types"], queryFn: () => api<ShiftType[]>("/api/v1/admin/shift-types"), staleTime: 300_000 });
  const staff = useQuery({ queryKey: ["users", "staff"], queryFn: () => api<User[]>("/api/v1/admin/users", { query: { role: "staff" } }) });
  const shifts = useQuery({
    queryKey: ["shifts", unit, from, to],
    queryFn: () => api<ShiftDay[]>("/api/v1/admin/shifts", { query: { from, to, unit: unit! } }),
    enabled: !!unit,
    placeholderData: (p) => p,
  });
  const status = useQuery({ queryKey: ["schedule", month], queryFn: () => api<ScheduleMonth>("/api/v1/admin/schedule", { query: { month } }) });
  const hol = useQuery({ queryKey: ["holidays", from, to], queryFn: () => api<Holiday[]>("/api/v1/admin/holidays", { query: { from, to } }), staleTime: 300_000 });
  const holidays = useMemo(() => new Map((hol.data ?? []).map((h) => [h.date, h.name])), [hol.data]);

  const people = useMemo(() => (staff.data ?? []).filter((u) => u.unit === unit && u.is_active !== false).sort((a, b) => a.name.localeCompare(b.name)), [staff.data, unit]);
  const cells = useMemo(() => new Map((shifts.data ?? []).map((x) => [key(x.user_id, x.date), x])), [shifts.data]);
  const active = (types.data ?? []).filter((t) => t.active);
  const period = status.data?.units.find((u) => u.unit === unit) ?? null;
  const draft = period?.status === "draft";
  const canEdit = s.can.editSchedule && to >= today;
  const editable = (d: string) => canEdit && d >= today;

  const warn = useMemo(
    () => new Map(people.map((p) => [p.id, warningsFor(days, (d) => cells.get(key(p.id, d))?.shift ?? null)])),
    [people, days, cells],
  );
  const warnCount = [...warn.values()].reduce((a, w) => a + w.length, 0);

  const save = useMutation({
    mutationFn: async (items: Item[]) => {
      const sum = { updated: 0, skipped: 0 };
      for (let i = 0; i < items.length; i += 2000) {
        const r = await api<BulkResult>("/api/v1/admin/shifts", { method: "PUT", body: { items: items.slice(i, i + 2000) } });
        sum.updated += r.updated;
        sum.skipped += r.skipped;
      }
      return sum;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedule-index"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
      toast(r.skipped ? `${r.updated} sel diperbarui · ${r.skipped} dilewati (shift hari ini sudah mulai, ada absensi, atau izin)` : `${r.updated} sel diperbarui`);
    },
    onError: (e) => toast(errMsg(e)),
  });
  const publish = useMutation({
    mutationFn: () => api("/api/v1/admin/schedule/publish", { body: { month, unit } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule"] });
      setModal(null);
      toast(`Jadwal ${label(month)} terbit`);
    },
    onError: (e) => toast(errMsg(e)),
  });

  /** Simpan perubahan untuk sel yang bisa diubah dan nilainya berbeda. */
  function apply(values: Map<string, number | null>) {
    const items: Item[] = [];
    for (const [k, v] of values) {
      const [uid, d] = k.split("|");
      if (!editable(d)) continue;
      if ((cells.get(k)?.shift.id ?? null) === v) continue;
      items.push({ user_id: Number(uid), date: d, shift_type_id: v });
    }
    if (items.length) save.mutate(items);
    else toast("Tidak ada perubahan");
  }
  const fill = (typeId: number | null) => {
    apply(new Map([...sel].map((k) => [k, typeId])));
    setSel(new Set());
  };

  // ---------------------------------------------------------- pemilihan sel
  const rect = (a: { r: number; c: number }, b: { r: number; c: number }) => {
    const out = new Set<string>();
    for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) if (editable(days[c])) out.add(key(people[r].id, days[c]));
    return out;
  };
  function down(e: React.MouseEvent, r: number, c: number) {
    if (!editable(days[c])) return;
    e.preventDefault();
    const k = key(people[r].id, days[c]);
    if (e.shiftKey && anchor.current) return setSel(rect(anchor.current, { r, c }));
    if (e.ctrlKey || e.metaKey) {
      const n = new Set(sel);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      anchor.current = { r, c };
      return setSel(n);
    }
    anchor.current = { r, c };
    dragging.current = true;
    setSel(new Set([k]));
  }
  const enter = (r: number, c: number) => dragging.current && anchor.current && setSel(rect(anchor.current, { r, c }));
  const toggleAll = (ks: string[]) => {
    const all = ks.length > 0 && ks.every((k) => sel.has(k));
    setSel(all ? new Set([...sel].filter((k) => !ks.includes(k))) : new Set([...sel, ...ks]));
  };
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  // pintasan: huruf kode shift (P, S, M, …), L / Delete = libur, Esc = batal pilih
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (!sel.size || modal || e.ctrlKey || e.metaKey || el?.closest("input,textarea,select")) return;
    if (e.key === "Escape") return setSel(new Set());
    if (e.key === "Delete" || e.key === "Backspace" || e.key.toLowerCase() === "l") return fill(null);
    const t = active.find((x) => shiftTone(x.name, x.color).code === e.key.toUpperCase());
    if (t) fill(t.id);
  });
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedPeople = people.filter((p) => days.some((d) => sel.has(key(p.id, d))));
  // tanggal sel terpilih (mulai hari ini) -> rentang awal di Atur jadwal (mis. mengisi satu hari yang terlewat)
  const selDays = [...sel].map((k) => k.split("|")[1]).filter((d) => !!today && d >= today).sort();
  const selRange = selDays.length ? { from: selDays[0], to: selDays[selDays.length - 1] } : null;
  const targetPeople = selectedPeople.length ? selectedPeople : people;
  type ImportResult = BulkResult & { errors: string[] };
  async function importRoster(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    if (unit) fd.append("unit", unit); // Kepala Unit beberapa unit: unit yang sedang dipilih
    const r = await api<ImportResult>("/api/v1/admin/schedule/import", { body: fd });
    qc.invalidateQueries({ queryKey: ["shifts"] });
    qc.invalidateQueries({ queryKey: ["schedule"] });
    qc.invalidateQueries({ queryKey: ["schedule-index"] });
    return r;
  }
  const wide = view === "minggu";
  const nav = (n: number) => {
    setSel(new Set());
    if (wide) {
      const w = addDays(week, 7 * n);
      setWeek(w);
      setMonth(ym(addDays(w, 3)));
    } else setMonth(shiftMonth(month, n));
  };
  const coverage = (typeId: number, d: string) => people.reduce((n, p) => n + (cells.get(key(p.id, d))?.shift.id === typeId ? 1 : 0), 0);
  const loading = shifts.isLoading || staff.isLoading || types.isLoading;
  const deadline = status.data?.deadline;
  const late = draft && !!deadline && today > deadline;

  return (
    <Page>
      <PageHeader
        left={
          <PillTabs
            label="Tampilan jadwal"
            value={tab}
            onChange={(v) => (setTab(v), setSel(new Set()))}
            tabs={[
              { value: "kalender", label: "Kalender" },
              { value: "daftar", label: "Daftar" },
            ]}
          />
        }
        action={
          <>
            {unit && (
              <Button
                variant="outline"
                onClick={() => download(`/api/v1/admin/schedule/export?month=${month}&unit=${encodeURIComponent(unit)}`, `Jadwal_${unit}_${month}.xlsx`).catch((e) => toast(errMsg(e)))}
              >
                <Download size={15} /> Ekspor
              </Button>
            )}
            {s.can.editSchedule && (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload size={15} /> Impor
                </Button>
                <Button onClick={() => setAssign(selectedPeople.map((p) => p.id))}>
                  <CalendarPlus size={15} /> Atur jadwal
                </Button>
              </>
            )}
          </>
        }
      />

      {tab === "daftar" ? (
        <ScheduleIndex unit={unit} canEdit={s.can.editSchedule} onAssign={(ids) => setAssign(ids)} />
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-9 items-center gap-0.5 rounded-lg bg-track p-[3px]">
          <button aria-label="Sebelumnya" onClick={() => nav(-1)} className="flex size-[30px] items-center justify-center rounded-md hover:bg-raised">
            <ChevronLeft size={16} />
          </button>
          <span className="tnum min-w-[130px] text-center text-[13px] font-semibold">{wide ? fmtRange(days[0], days[6]) : label(month)}</span>
          <button aria-label="Berikutnya" onClick={() => nav(1)} className="flex size-[30px] items-center justify-center rounded-md hover:bg-raised">
            <ChevronRight size={16} />
          </button>
        </div>
        <PillTabs
          label="Rentang"
          value={view}
          onChange={(v) => {
            setSel(new Set());
            if (v === "minggu") setWeek(monday(ym(today) === month ? today : `${month}-01`));
            setView(v);
          }}
          tabs={[
            { value: "bulan", label: "Bulan" },
            { value: "minggu", label: "Minggu" },
          ]}
        />
        {!s.lockedUnit ? (
          <Select className="w-[200px]" value={unitSel ?? ""} onChange={(v) => (setUnitSel(v), setSel(new Set()))} options={s.units.map((u) => ({ value: u.name, label: u.name }))} />
        ) : (
          s.can.unitFilter && <LockedScope label={s.lockedUnit} />
        )}
        {period && (
          <span
            className={cx(
              "flex h-7 items-center rounded-md px-2.5 text-xs font-medium",
              draft ? (late ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn") : "bg-ok-bg text-ok",
            )}
          >
            {draft ? (late ? "Draf · lewat batas" : "Draf") : `Terbit${period.published_at ? ` ${fmtDate(period.published_at.slice(0, 10))}` : ""}`}
          </span>
        )}
        {draft && deadline && <span className="tnum text-[13px] text-muted">Batas terbit {fmtDate(deadline)}</span>}
        <span className="flex-1" />
        {canEdit && (
          <>
            <Button variant="outline" onClick={() => setModal("copy")}>
              <Copy size={15} /> Salin 4 minggu lalu
            </Button>
            {draft && (
              <Button onClick={() => setModal("publish")} disabled={!period?.shifts}>
                <Send size={15} /> Terbitkan
              </Button>
            )}
          </>
        )}
      </div>

      {canEdit && (
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          {sel.size > 0 ? (
            <>
              <span className="tnum text-[13px] font-medium">{sel.size} sel</span>
              {active.map((t) => {
                const c = shiftTone(t.name, t.color);
                return (
                  <button key={t.id} onClick={() => fill(t.id)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium" style={toneStyle(c.bg, c.fg)}>
                    <kbd className="font-sans text-[11px] font-semibold opacity-70">{c.code}</kbd>
                    {t.name}
                  </button>
                );
              })}
              <button onClick={() => fill(null)} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] font-medium text-muted hover:bg-soft">
                <kbd className="font-sans text-[11px] font-semibold opacity-70">L</kbd>
                Libur
              </button>
              <button onClick={() => setSel(new Set())} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted hover:text-ink">
                <X size={14} /> Batal
              </button>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {active.map((t) => {
                const c = shiftTone(t.name, t.color);
                return (
                  <span key={t.id} className="tnum flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium" style={toneStyle(c.bg, c.fg)}>
                    <b>{c.code}</b> {t.name} {hhmm(t.start_time)}–{hhmm(t.end_time)}
                  </span>
                );
              })}
              <span className="ml-1 text-xs text-faint">Klik atau seret sel · Shift untuk rentang · Ctrl untuk tambah</span>
              {holidays.size > 0 && <span className="ml-1 flex items-center gap-1 text-xs text-bad">● Libur nasional</span>}
            </div>
          )}
        </div>
      )}

      {shifts.isError ? (
        <ErrorState message={(shifts.error as Error).message} onRetry={() => shifts.refetch()} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-max min-w-full select-none border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[200px] border-b border-line bg-card px-3 py-2 text-left text-xs font-medium text-muted">Karyawan</th>
                  {days.map((d) => {
                    const dow = parseDate(d).getUTCDay();
                    const col = people.map((p) => key(p.id, d)).filter(() => editable(d));
                    const h = holidays.get(d);
                    return (
                      <th key={d} title={h} className={cx("border-b border-line px-0 py-1.5 font-medium", (dow === 0 || dow === 6 || h) && "bg-soft/60", wide && "min-w-[132px] px-1")}>
                        <button
                          disabled={!editable(d)}
                          onClick={() => toggleAll(col)}
                          className={cx(
                            "relative mx-auto flex flex-col items-center rounded-md py-0.5",
                            wide ? "w-full" : "w-9",
                            d === today ? "bg-brand text-white" : dow === 0 || h ? "text-bad" : "text-muted",
                            editable(d) && d !== today && "hover:bg-soft",
                          )}
                        >
                          <span className="text-[10.5px]">{DAY3[dow]}{wide && h ? ` · ${h}` : ""}</span>
                          <span className={cx("tnum text-[13px] font-semibold", d !== today && "text-ink")}>{Number(d.slice(8))}</span>
                          {h && !wide && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-bad" />}
                        </button>
                      </th>
                    );
                  })}
                  <th className="border-b border-l border-line px-2 text-xs font-medium text-muted">Shift</th>
                  <th className="border-b border-line px-2 text-xs font-medium text-muted">Malam</th>
                  <th className="border-b border-line px-2 text-xs font-medium text-muted">Libur</th>
                </tr>
              </thead>
              <tbody>
                {loading &&
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={days.length + 4} className="px-3 py-2">
                        <Skel className="h-8 rounded-md" />
                      </td>
                    </tr>
                  ))}
                {!loading &&
                  people.map((p, r) => {
                    const row = days.map((d) => key(p.id, d)).filter((k) => editable(k.split("|")[1]));
                    const mine = days.map((d) => cells.get(key(p.id, d))?.shift ?? null);
                    const total = mine.filter(Boolean).length;
                    const nights = mine.filter((t) => t && minutes(t.end_time) <= minutes(t.start_time)).length;
                    const w = warn.get(p.id) ?? [];
                    return (
                      <tr key={p.id} className="group">
                        <td className="sticky left-0 z-10 border-b border-line2 bg-card px-3 py-1">
                          <button disabled={!row.length} onClick={() => toggleAll(row)} className="flex w-full min-w-0 items-center gap-2 text-left">
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-[13px] font-medium">{p.name}</span>
                              <span className="tnum text-[11px] text-faint">{p.employee_code}</span>
                            </span>
                            {w.length > 0 && (
                              <span title={w.join("\n")} className="flex items-center gap-0.5 text-warn">
                                <AlertTriangle size={14} />
                                <span className="tnum text-[11px] font-semibold">{w.length}</span>
                              </span>
                            )}
                          </button>
                        </td>
                        {days.map((d, c) => {
                          const k = key(p.id, d);
                          const x = cells.get(k);
                          const t = x ? shiftTone(x.shift.name, x.shift.color) : null;
                          const dow = parseDate(d).getUTCDay();
                          const on = sel.has(k);
                          const h = holidays.get(d);
                          return (
                            <td key={d} className={cx("border-b border-line2 p-[2px]", (dow === 0 || dow === 6 || h) && "bg-soft/60")}>
                              <div
                                onMouseDown={(e) => down(e, r, c)}
                                onMouseEnter={() => enter(r, c)}
                                title={`${p.name} · ${DAY3[dow]} ${fmtDate(d)} · ${x ? `${x.shift.name} ${hhmm(x.shift.start_time)}–${hhmm(x.shift.end_time)}` : "Libur"}${x?.pending_swap ? " · tukar shift berjalan" : ""}`}
                                className={cx(
                                  "flex items-center rounded-md text-[12px] font-semibold",
                                  wide ? "h-11 w-full flex-col items-start justify-center px-2 leading-tight" : "h-8 w-9 justify-center",
                                  editable(d) ? "cursor-pointer" : "cursor-default",
                                  d < today && "opacity-50",
                                  !t && "text-faint",
                                )}
                                style={{
                                  ...(t ? toneStyle(t.bg, t.fg) : {}),
                                  boxShadow: [on ? "0 0 0 2px var(--color-brand)" : "", x?.pending_swap ? "inset 0 0 0 1.5px #D98A00" : ""].filter(Boolean).join(",") || undefined,
                                }}
                              >
                                {wide ? (
                                  x ? (
                                    <>
                                      <span className="tnum text-[11.5px] font-medium opacity-80">
                                        {hhmm(x.shift.start_time)}–{hhmm(x.shift.end_time)}
                                      </span>
                                      <span className="max-w-full truncate">{x.shift.name}</span>
                                    </>
                                  ) : (
                                    <span className="font-medium">{h ? "Libur nasional" : "Libur"}</span>
                                  )
                                ) : t ? (
                                  t.code
                                ) : (
                                  "·"
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="tnum border-b border-l border-line2 px-2 text-center text-[12.5px] font-medium">{total}</td>
                        <td className="tnum border-b border-line2 px-2 text-center text-[12.5px] text-muted">{nights}</td>
                        <td className="tnum border-b border-line2 px-2 text-center text-[12.5px] text-muted">{days.length - total}</td>
                      </tr>
                    );
                  })}
              </tbody>
              {!loading && people.length > 0 && (
                <tfoot>
                  {active.map((t, i) => {
                    const c = shiftTone(t.name, t.color);
                    return (
                      <tr key={t.id}>
                        <td className={cx("sticky left-0 z-10 bg-card px-3 py-1 text-xs text-muted", i === 0 && "border-t border-line")}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full" style={{ background: c.fg }} />
                            {t.name}
                          </span>
                        </td>
                        {days.map((d) => {
                          const n = coverage(t.id, d);
                          return (
                            <td key={d} className={cx("tnum py-1 text-center text-[11.5px]", i === 0 && "border-t border-line", n ? "text-ink" : "text-off")}>
                              {n || "–"}
                            </td>
                          );
                        })}
                        <td colSpan={3} className={cx(i === 0 && "border-t border-line")} />
                      </tr>
                    );
                  })}
                </tfoot>
              )}
            </table>
          </div>
          {staff.isSuccess && people.length === 0 && <Empty />}
        </Card>
      )}

      </>
      )}

      {modal === "publish" && period && (
        <Modal open onClose={() => setModal(null)} width={440}>
          <ModalHead title={`Terbitkan jadwal ${label(month)}?`} sub={unit ?? undefined} onClose={() => setModal(null)} />
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Terjadwal", `${period.scheduled_staff}/${period.staff}`],
              ["Shift", String(period.shifts)],
              ["Peringatan", String(warnCount)],
            ].map(([l, v]) => (
              <div key={l} className="flex flex-col gap-0.5 rounded-lg bg-soft px-3 py-2.5">
                <span className="text-xs text-muted">{l}</span>
                <span className={cx("tnum text-base font-semibold", l === "Peringatan" && warnCount > 0 && "text-warn")}>{v}</span>
              </div>
            ))}
          </div>
          <span className="text-[13px] text-muted">Karyawan bisa melihat jadwal dan menerima notifikasi. Perubahan setelah terbit tetap diberitahukan ke karyawan.</span>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setModal(null)}>
              Batal
            </Button>
            <Button loading={publish.isPending} onClick={() => publish.mutate()}>
              <Send size={15} /> Terbitkan
            </Button>
          </div>
        </Modal>
      )}
      {modal === "copy" && unit && (
        <CopyModal
          month={month}
          unit={unit}
          people={targetPeople}
          scoped={selectedPeople.length > 0}
          days={days.filter(editable)}
          current={cells}
          onApply={(v) => {
            apply(v);
            setModal(null);
            setSel(new Set());
          }}
          onClose={() => setModal(null)}
        />
      )}
      {importOpen && unit && (
        <ImportModal<ImportResult>
          title="Impor jadwal"
          sub={`${unit} · ${label(month)}`}
          template={{
            label: `Template jadwal ${label(month)}`,
            download: () => download(`/api/v1/admin/schedule/export?month=${month}&unit=${encodeURIComponent(unit)}`, `Jadwal_${unit}_${month}.xlsx`),
          }}
          upload={importRoster}
          renderResult={(r) => (
            <ImportSummary
              blocking={false}
              stats={[
                { label: "Sel diperbarui", value: r.updated, tone: "ok" },
                { label: "Dilewati (terkunci)", value: r.skipped, tone: "warn" },
                { label: "Kode salah", value: r.errors.length, tone: "warn" },
              ]}
              errors={r.errors}
            />
          )}
          onClose={() => setImportOpen(false)}
        />
      )}
      <AssignDrawer open={assign !== null} people={people} initial={assign ?? []} range={selRange} types={types.data ?? []} today={today} onClose={() => setAssign(null)} />
    </Page>
  );
}

/** Salin jadwal 4 minggu sebelumnya (hari yang sama dalam minggu) ke hari-hari yang bisa diubah. */
function CopyModal({
  month,
  unit,
  people,
  scoped,
  days,
  current,
  onApply,
  onClose,
}: {
  month: string;
  unit: string;
  people: User[];
  scoped: boolean;
  days: string[];
  current: Map<string, ShiftDay>;
  onApply: (v: Map<string, number | null>) => void;
  onClose: () => void;
}) {
  const first = days[0];
  const prev = useQuery({
    queryKey: ["shifts", unit, first ? addDays(first, -28) : month, first ? addDays(first, -1) : month],
    queryFn: () => api<ShiftDay[]>("/api/v1/admin/shifts", { query: { from: addDays(first, -28), to: addDays(first, -1), unit } }),
    enabled: !!first,
  });
  function run() {
    const src = new Map<string, number | null>();
    for (const x of prev.data ?? []) src.set(key(x.user_id, x.date), x.shift.id);
    for (const [k, x] of current) if (k.split("|")[1] < first) src.set(k, x.shift.id);
    const out = new Map<string, number | null>();
    for (const p of people)
      for (const d of days) {
        const v = src.get(key(p.id, addDays(d, -28))) ?? null;
        src.set(key(p.id, d), v); // hari ke-29 dst. mengikuti hasil salinan
        out.set(key(p.id, d), v);
      }
    onApply(out);
  }
  return (
    <Modal open onClose={onClose} width={440}>
      <ModalHead title="Salin 4 minggu lalu" sub={label(month)} onClose={onClose} />
      {!first ? (
        <span className="text-[13px] text-muted">Tidak ada tanggal yang bisa diubah di bulan ini.</span>
      ) : (
        <span className="text-[13px] text-muted">
          Jadwal {fmtDate(addDays(first, -28))} – {fmtDate(addDays(first, -1))} diulang mulai {fmtDate(first)} untuk {scoped ? `${people.length} karyawan terpilih` : `semua ${people.length} karyawan`}. Sel yang sudah terisi
          akan ditimpa.
        </span>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button disabled={!first || prev.isLoading} loading={prev.isLoading} onClick={run}>
          <Copy size={15} /> Salin
        </Button>
      </div>
    </Modal>
  );
}
