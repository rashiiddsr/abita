import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Download, FileSpreadsheet, FileText } from "lucide-react";
import { useRouter } from "@/lib/nav";
import { useMemo, useState } from "react";
import { useToast } from "@/components/providers";
import { PillTabs } from "@/components/pill-tabs";
import { Page } from "@/components/shell";
import { Button, Card, Checkbox, ErrorState, LockedScope, Modal, ModalHead, PageHeader, Segmented, Select, Skel, cx, Empty } from "@/components/ui";
import { api, download, errMsg } from "@/lib/api";
import { MONTHS, addDays, fmtAgo, fmtDate, fmtDateShort, fmtRange, parseDate, todayWib } from "@/lib/format";
import { useMounted, useSession } from "@/lib/session";
import { REQ, tipe } from "@/lib/status";
import type { AttendanceReport, ExportOut, Report, RequestReport, ScheduleReport, StaffReport } from "@/lib/types";

export const Route = createFileRoute("/_app/reports")({ component: LaporanPage });

type Tab = "hadir" | "req" | "jadwal" | "kr";
const COLS: Record<Tab, string[]> = {
  hadir: ["Nama & NIK", "Unit", "Hadir", "Terlambat", "Izin", "Sakit", "Alpa", "Total jam", "Detail check in/out"],
  req: ["Karyawan", "Unit", "Jenis", "Tanggal", "Alasan", "Status", "Penanggung jawab", "Rekan tukar"],
  jadwal: ["Nama & NIK", "Unit", "Total shift", "Rincian shift", "Malam", "Libur", "Tukar disetujui"],
  kr: ["Nama & NIK", "Tipe", "Unit", "Nomor HP", "Mulai dinas", "Status", "Wajah"],
};
const TAB_NAME: Record<Tab, string> = { hadir: "Kehadiran", req: "Pengajuan", jadwal: "Jadwal", kr: "Karyawan" };
const KIND_LABEL: Record<string, string> = { izin: "Izin", sakit: "Sakit", tukar: "Tukar shift" };

function LaporanPage() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useMounted(() => todayWib());
  const [tab, setTabState] = useState<Tab>("hadir");
  const [period, setPeriod] = useState<"mingguan" | "bulanan">("bulanan");
  const [refSel, setRef] = useState<string | null>(null); // YYYY-MM atau tanggal Senin
  const [unitSel, setUnitSel] = useState("all");
  const [tipeSel, setTipe] = useState("all");
  const [status, setStatus] = useState("all");
  const [exp, setExp] = useState(false);
  const unit = s.lockedUnit ?? (unitSel === "all" ? undefined : unitSel);

  const dateOpts = useMemo(() => {
    if (!today) return [];
    if (period === "bulanan") {
      const [y, m] = today.split("-").map(Number);
      // laporan jadwal juga menampilkan bulan depan (sedang disusun)
      const lead = tab === "jadwal" ? 1 : 0;
      return [...Array(6 + lead)].map((_, i) => {
        const d = new Date(Date.UTC(y, m - 1 - i + lead, 1));
        const v = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        return { value: v, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
      });
    }
    const mon = addDays(today, -((parseDate(today).getUTCDay() + 6) % 7));
    return [...Array(8)].map((_, i) => {
      const a = addDays(mon, -7 * i);
      return { value: a, label: fmtRange(a, addDays(a, 6)) };
    });
  }, [today, period, tab]);
  // periode terpilih harus ada di daftar (berganti saat Mingguan/Bulanan diubah)
  const ref = refSel && dateOpts.some((o) => o.value === refSel) ? refSel : (dateOpts[0]?.value ?? null);
  const setTab = (t: Tab) => {
    setTabState(t);
    setStatus("all");
  };

  const query = {
    tab,
    period,
    month: period === "bulanan" ? (ref ?? undefined) : undefined,
    week: period === "mingguan" ? (ref ?? undefined) : undefined,
    unit,
    tipe: tipeSel,
    status,
  };
  const rep = useQuery({ queryKey: ["report", query], queryFn: () => api<Report>("/api/v1/admin/reports", { query }), enabled: !!ref, placeholderData: (p) => p });
  const hist = useQuery({ queryKey: ["exports"], queryFn: () => api<ExportOut[]>("/api/v1/admin/reports/exports") });

  const statusOpts =
    tab === "hadir"
      ? [
          { value: "all", label: "Semua status" },
          { value: "telat", label: "Pernah terlambat" },
          { value: "alpa", label: "Pernah alpa" },
        ]
      : tab === "req"
        ? [
            { value: "all", label: "Semua status" },
            { value: "pending", label: "Menunggu" },
            { value: "approved", label: "Disetujui" },
            { value: "rejected", label: "Ditolak" },
            { value: "cancelled", label: "Dibatalkan" },
          ]
        : tab === "jadwal"
          ? []
          : [
            { value: "all", label: "Semua status" },
            { value: "aktif", label: "Aktif" },
            { value: "nonaktif", label: "Nonaktif" },
          ];
  const unitLabel = unit ?? "Semua unit";
  const r = rep.data && rep.data.tab === tab ? rep.data : undefined;

  return (
    <Page>
      <PageHeader
        left={
          <PillTabs
            label="Jenis laporan"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "hadir", label: "Kehadiran" },
              { value: "req", label: "Pengajuan" },
              { value: "jadwal", label: "Jadwal" },
              { value: "kr", label: "Karyawan" },
            ]}
          />
        }
        action={
          <Button onClick={() => setExp(true)} disabled={!r}>
            <Download size={15} /> Ekspor laporan
          </Button>
        }
      />

      <Card className="flex flex-wrap items-center gap-2.5 px-4 py-3.5">
        {tab !== "kr" && (
          <>
            <Segmented
              size="sm"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "mingguan", label: "Mingguan" },
                { value: "bulanan", label: "Bulanan" },
              ]}
            />
            <Calendar size={16} className="ml-1 text-muted" />
            <Select value={ref ?? ""} onChange={setRef} options={dateOpts} />
          </>
        )}
        {!s.lockedUnit ? (
          <Select value={unitSel} onChange={setUnitSel} options={[{ value: "all", label: "Semua unit" }, ...s.units.map((u) => ({ value: u.name, label: u.name }))]} />
        ) : (
          s.can.unitFilter && <LockedScope label={s.lockedUnit} />
        )}
        <Select
          value={tipeSel}
          onChange={setTipe}
          options={[
            { value: "all", label: "Semua tipe" },
            { value: "magang", label: "Magang / PKL" },
            { value: "outsourcing", label: "Outsourcing" },
          ]}
        />
        {statusOpts.length > 0 && <Select value={status} onChange={setStatus} options={statusOpts} />}
      </Card>

      {rep.isError ? (
        <ErrorState message={(rep.error as Error).message} onRetry={() => rep.refetch()} />
      ) : !r ? (
        <>
          <Skel className="h-[340px] rounded-xl" />
          <Skel className="h-60 rounded-xl" />
        </>
      ) : (
        <>
          <Card className={cx("px-[22px] py-5 transition-opacity", rep.isFetching && "opacity-60")}>
            <Summary r={r} />
            {r.tab === "hadir" && <DailyBars r={r} />}
            {r.tab === "req" && <WeekBars r={r} />}
            {r.tab === "jadwal" && <ScheduleBars r={r} />}
            {r.tab === "kr" && <UnitBars r={r} />}
          </Card>
          {r.tab === "req" && r.units.length > 0 && <RequestUnits r={r} />}
          {r.tab === "jadwal" && <ScheduleUnits r={r} />}
          <Preview r={r} unitLabel={unitLabel} />
        </>
      )}

      <Card className="px-5 pb-1.5 pt-[18px]">
        <span className="mb-1 block text-[15px] font-semibold">Riwayat ekspor</span>
        {hist.data?.length === 0 && <Empty compact />}
        {(hist.data ?? []).map((x, i, a) => (
          <div key={x.id} className={cx("flex items-center gap-3 py-3", i < a.length - 1 && "border-b border-line2")}>
            <span className="flex size-[38px] flex-none items-center justify-center rounded-xl bg-brand-soft text-brand">
              {x.name.endsWith(".pdf") ? <FileText size={18} /> : <FileSpreadsheet size={18} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{x.name}</span>
              <span className="text-[12.5px] font-normal text-muted">
                {x.meta}
                {x.by ? ` · oleh ${x.by}` : ""} · {fmtAgo(x.at)}
              </span>
            </span>
            {x.ready ? (
              <Button
                variant="soft"
                size="sm"
                onClick={() => download(`/api/v1/admin/reports/exports/${x.id}/file`, x.name).catch((e) => toast(errMsg(e)))}
              >
                <Download size={15} /> Unduh
              </Button>
            ) : (
              <span className="text-xs font-medium text-faint">Kedaluwarsa</span>
            )}
          </div>
        ))}
      </Card>

      {exp && r && (
        <ExportModal
          tab={tab}
          recap={`${TAB_NAME[tab]} · ${unitLabel} · ${r.label}`}
          onClose={() => setExp(false)}
          onDone={(x) => {
            qc.invalidateQueries({ queryKey: ["exports"] });
            setExp(false);
            toast(`${x.name} siap diunduh`);
            download(`/api/v1/admin/reports/exports/${x.id}/file`, x.name).catch(() => null);
          }}
          query={query}
        />
      )}
    </Page>
  );
}

function Summary({ r }: { r: Report }) {
  const items =
    r.tab === "hadir"
      ? [
          { n: r.kpi.rate == null ? "–" : `${r.kpi.rate.toFixed(1).replace(".", ",")}%`, l: "rata-rata hadir" },
          { n: r.kpi.telat, l: "terlambat" },
          { n: r.kpi.izin, l: "izin" },
          { n: r.kpi.sakit, l: "sakit" },
          { n: r.kpi.alpa, l: "alpa" },
        ]
      : r.tab === "req"
        ? [
            { n: r.kpi.izin + r.kpi.sakit, l: "izin & sakit" },
            { n: r.kpi.swaps, l: "tukar shift" },
            { n: r.kpi.approved, l: "disetujui" },
            { n: r.kpi.pending, l: "menunggu" },
            { n: r.kpi.overdue, l: "lewat 24 jam" },
            { n: r.kpi.avg_decision_hours == null ? "–" : `${r.kpi.avg_decision_hours.toFixed(1).replace(".", ",")} jam`, l: "rata-rata keputusan" },
          ]
        : r.tab === "jadwal"
          ? [
              { n: `${r.kpi.published}/${r.kpi.units}`, l: "unit terbit" },
              { n: r.kpi.late, l: "terlambat terbit" },
              { n: r.kpi.shifts, l: "shift" },
              { n: r.kpi.unscheduled, l: "karyawan tanpa jadwal" },
              { n: r.kpi.swaps, l: "tukar disetujui" },
            ]
          : [
            { n: r.kpi.total, l: "karyawan" },
            { n: r.kpi.magang, l: "magang/PKL" },
            { n: r.kpi.outsourcing, l: "outsourcing" },
            { n: r.kpi.no_face, l: "belum daftar wajah" },
          ];
  return (
    <div className="mb-[18px] flex flex-wrap items-baseline gap-x-7 gap-y-2 border-b border-line pb-[18px]">
      {items.map((x) => (
        <span key={x.l} className="flex items-baseline gap-[7px]">
          <span className="tnum text-2xl font-semibold">{x.n}</span>
          <span className="text-[13px] font-medium text-muted">{x.l}</span>
        </span>
      ))}
    </div>
  );
}

function ChartHead({ title, legend }: { title: string; legend: { l: string; c: string }[] }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
      <span className="text-[15px] font-semibold">{title}</span>
      <div className="flex gap-3.5 text-[12.5px] font-medium text-muted">
        {legend.map((l) => (
          <span key={l.l} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: l.c }} />
            {l.l}
          </span>
        ))}
      </div>
    </div>
  );
}

function DailyBars({ r }: { r: AttendanceReport }) {
  const bars = r.daily;
  const min = Math.max(0, Math.floor(Math.min(...bars.map((b) => b.rate ?? 100), 100) / 10) * 10 - 10);
  const avg = r.kpi.rate ?? 0;
  const many = bars.length > 10;
  return (
    <>
      <ChartHead
        title={`Persentase hadir harian · ${r.label}`}
        legend={[
          { l: "≥ rata-rata", c: "#007A87" },
          { l: "< rata-rata", c: "#D98A00" },
        ]}
      />
      {bars.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-[13px] font-medium text-muted">Periode belum berjalan</div>
      ) : (
        <>
          <div className="flex h-[220px] items-end gap-1.5 border-b border-line px-1">
            {bars.map((b) => {
              const h = b.rate == null ? 0 : ((b.rate - min) / (100 - min)) * 190 + 6;
              return (
                <div key={b.date} title={`${fmtDate(b.date)}: ${b.rate == null ? "tidak ada jadwal" : `${b.rate}%`}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                  {!many && <span className="tnum text-[11px] font-medium text-muted">{b.rate == null ? "" : `${Math.round(b.rate)}%`}</span>}
                  <span className="w-full max-w-[44px] rounded-t-md rounded-b-sm" style={{ height: h, background: b.rate == null ? "var(--color-track)" : b.rate >= avg ? "var(--color-brand)" : "var(--color-amber)" }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 px-1 pt-1.5">
            {bars.map((b, i) => (
              <span key={b.date} className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-center text-[11px] font-medium text-faint">
                {many ? (i % 3 === 0 ? parseDate(b.date).getUTCDate() : "") : fmtDateShort(b.date)}
              </span>
            ))}
          </div>
        </>
      )}
      {r.units.length > 1 && (
        <div className="mt-5 flex flex-col gap-2.5 border-t border-line pt-4">
          <span className="text-[13px] font-semibold text-muted">Per unit</span>
          {r.units.map((u) => (
            <div key={u.unit} className="grid grid-cols-[minmax(90px,200px)_minmax(0,1fr)_48px] items-center gap-3">
              <span className="truncate text-[13px] font-medium">{u.unit}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-soft">
                <span className="block h-full rounded-full" style={{ width: `${u.rate ?? 0}%`, background: (u.rate ?? 0) < 80 ? "#D98A00" : "#007A87" }} />
              </span>
              <span className="tnum text-right text-[13px] font-semibold">{u.rate == null ? "–" : `${Math.round(u.rate)}%`}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function WeekBars({ r }: { r: RequestReport }) {
  const max = Math.max(1, ...r.weeks.map((w) => Math.max(w.izin, w.sakit)));
  return (
    <>
      <ChartHead
        title={`Pengajuan per minggu · ${r.label}`}
        legend={[
          { l: "Izin", c: "#4F5BD5" },
          { l: "Sakit", c: "#C82829" },
        ]}
      />
      <div className="flex h-[220px] items-end gap-4 border-b border-line px-2 sm:gap-7 sm:px-6">
        {r.weeks.map((w) => (
          <div key={w.start} className="flex h-full flex-1 items-end justify-center gap-1.5">
            {[
              [w.izin, "#4F5BD5"],
              [w.sakit, "#C82829"],
            ].map(([n, c], i) => (
              <div key={i} className="flex flex-col items-center gap-[5px]">
                <span className="tnum text-xs font-semibold" style={{ color: c as string }}>
                  {n}
                </span>
                <span className="w-6 rounded-t-md rounded-b-sm sm:w-[34px]" style={{ height: ((n as number) / max) * 180 + 4, background: c as string }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-4 px-2 pt-2 sm:gap-7 sm:px-6">
        {r.weeks.map((w) => (
          <span key={w.start} className="flex-1 text-center text-xs font-medium text-faint">
            {w.label}
          </span>
        ))}
      </div>
    </>
  );
}

function UnitBars({ r }: { r: StaffReport }) {
  const max = Math.max(1, ...r.units.map((u) => u.total));
  return (
    <>
      <ChartHead
        title="Komposisi karyawan per unit"
        legend={[
          { l: "Magang / PKL", c: "#4F5BD5" },
          { l: "Outsourcing", c: "#D98A00" },
        ]}
      />
      <div className="flex flex-col gap-3">
        {r.units.map((u) => (
          <div key={u.unit} className="grid grid-cols-[minmax(90px,200px)_minmax(0,1fr)_44px] items-center gap-3">
            <span className="truncate text-[13px] font-medium">{u.unit}</span>
            <span className="flex h-[22px] overflow-hidden rounded-[7px] bg-soft">
              <span title={`Magang / PKL ${u.magang}`} style={{ width: `${(u.magang / max) * 100}%`, background: "#4F5BD5" }} />
              <span title={`Outsourcing ${u.outsourcing}`} style={{ width: `${(u.outsourcing / max) * 100}%`, background: "#D98A00" }} />
            </span>
            <span className="tnum text-right text-[13px] font-semibold">{u.total}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function ScheduleBars({ r }: { r: ScheduleReport }) {
  const max = Math.max(1, ...r.types.map((t) => t.count));
  return (
    <>
      <ChartHead title={`Distribusi shift · ${r.label}`} legend={[]} />
      {r.types.length === 0 && <Empty compact />}
      <div className="flex flex-col gap-3">
        {r.types.map((t) => (
          <div key={t.name} className="grid grid-cols-[minmax(80px,160px)_minmax(0,1fr)_52px] items-center gap-3">
            <span className="truncate text-[13px] font-medium">{t.name}</span>
            <span className="flex h-[22px] overflow-hidden rounded-[7px] bg-soft">
              <span className="bg-brand" style={{ width: `${(t.count / max) * 100}%` }} />
            </span>
            <span className="tnum text-right text-[13px] font-semibold">{t.count}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Status terbit jadwal per unit terhadap batas terbit. */
function ScheduleUnits({ r }: { r: ScheduleReport }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <span className="text-[15px] font-semibold">Status jadwal per unit</span>
        <span className="tnum text-[12.5px] font-medium text-faint">Batas terbit {fmtDate(r.deadline)}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[minmax(0,1.6fr)_110px_120px_90px_90px_90px] gap-3 border-b border-line px-5 py-3 text-xs font-medium text-faint">
            <span>Unit</span>
            <span>Status</span>
            <span>Terbit</span>
            <span className="text-right">Karyawan</span>
            <span className="text-right">Tanpa jadwal</span>
            <span className="text-right">Shift</span>
          </div>
          {r.units.map((u) => (
            <div key={u.unit} className="tnum grid grid-cols-[minmax(0,1.6fr)_110px_120px_90px_90px_90px] items-center gap-3 border-b border-line2 px-5 py-[11px] text-[13px] last:border-0">
              <span className="truncate font-medium">{u.unit}</span>
              <span className={cx("font-medium", u.status === "published" ? "text-ok" : "text-warn")}>{u.status === "published" ? "Terbit" : "Draf"}</span>
              <span className={cx(u.on_time === false && "text-bad")}>{u.published_at ? `${fmtDate(u.published_at)}${u.on_time === false ? " · telat" : ""}` : "—"}</span>
              <span className="text-right">{u.staff}</span>
              <span className={cx("text-right", u.unscheduled > 0 && "text-warn")}>{u.unscheduled}</span>
              <span className="text-right">{u.shifts}</span>
            </div>
          ))}
          {r.units.length === 0 && <Empty compact />}
        </div>
      </div>
    </Card>
  );
}

/** Pengajuan per unit: jumlah, status, dan rata-rata waktu keputusan Kepala Unit. */
function RequestUnits({ r }: { r: RequestReport }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pb-1 pt-4 text-[15px] font-semibold">Pengajuan per unit</div>
      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(4,80px)_130px] gap-3 border-b border-line px-5 py-3 text-xs font-medium text-faint">
            <span>Unit</span>
            <span className="text-right">Total</span>
            <span className="text-right">Disetujui</span>
            <span className="text-right">Ditolak</span>
            <span className="text-right">Menunggu</span>
            <span className="text-right">Rata-rata keputusan</span>
          </div>
          {r.units.map((u) => (
            <div key={u.unit} className="tnum grid grid-cols-[minmax(0,1.6fr)_repeat(4,80px)_130px] items-center gap-3 border-b border-line2 px-5 py-[11px] text-[13px] last:border-0">
              <span className="truncate font-medium">{u.unit}</span>
              <span className="text-right">{u.total}</span>
              <span className="text-right text-ok">{u.approved}</span>
              <span className="text-right text-bad">{u.rejected}</span>
              <span className={cx("text-right", u.pending > 0 && "text-warn")}>{u.pending}</span>
              <span className="text-right text-muted">{u.avg_hours == null ? "—" : `${u.avg_hours.toFixed(1).replace(".", ",")} jam`}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Preview({ r, unitLabel }: { r: Report; unitLabel: string }) {
  const router = useRouter();
  const max = 10;
  let head: string[];
  let rows: { key: string | number; cells: React.ReactNode[]; href?: string }[];
  let cols: string;
  if (r.tab === "hadir") {
    head = ["Nama & NIK", "Unit", "Hadir", "Terlambat", "Izin", "Sakit", "Alpa", "Total jam"];
    cols = "grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_repeat(5,minmax(0,.6fr))_minmax(0,.8fr)]";
    rows = r.rows.map((x) => ({
      key: x.user_id,
      cells: [
        <span key="n" className="truncate font-medium">
          {x.name}
        </span>,
        <span key="u" className="truncate text-muted">
          {x.unit ?? "—"}
        </span>,
        x.hadir,
        <span key="t" className={x.telat ? "text-warn" : ""}>
          {x.telat}
        </span>,
        x.izin,
        x.sakit,
        <span key="a" className={x.alpa ? "text-bad" : ""}>
          {x.alpa}
        </span>,
        <span key="j" className="text-muted">
          {x.jam.toFixed(1).replace(".", ",")} j
        </span>,
      ],
    }));
  } else if (r.tab === "req") {
    head = ["Karyawan", "Unit", "Jenis", "Tanggal", "Keterangan", "Status", "Penanggung jawab"];
    cols = "grid-cols-[minmax(160px,1.5fr)_minmax(140px,1.2fr)_96px_130px_minmax(120px,1fr)_96px_minmax(120px,1fr)]";
    rows = r.rows.map((x) => ({
      key: x.id,
      href: x.href,
      cells: [
        <span key="n" className="truncate font-medium">
          {x.name}
        </span>,
        <span key="u" className="truncate text-muted">
          {x.unit ?? "—"}
        </span>,
        KIND_LABEL[x.kind] ?? x.kind,
        fmtRange(x.start_date, x.end_date),
        <span key="d" className="truncate text-muted">
          {x.kind === "tukar" ? (x.target ? `↔ ${x.target}` : x.reason) : `${Math.round((parseDate(x.end_date).getTime() - parseDate(x.start_date).getTime()) / 864e5) + 1} hari`}
        </span>,
        <span key="s" className="font-medium" style={{ color: REQ[x.status].fg }}>
          {REQ[x.status].label}
        </span>,
        <span key="r" className="truncate text-muted">
          {x.reviewer ?? "—"}
        </span>,
      ],
    }));
  } else if (r.tab === "jadwal") {
    head = ["Nama & NIK", "Unit", "Total", "Rincian", "Malam", "Libur", "Tukar"];
    cols = "grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_64px_minmax(0,1.4fr)_64px_64px_64px]";
    rows = r.rows.map((x) => ({
      key: x.user_id,
      href: `/staff/${x.user_id}`,
      cells: [
        <span key="n" className="truncate font-medium">
          {x.name} · {x.employee_code}
        </span>,
        <span key="u" className="truncate text-muted">
          {x.unit ?? "—"}
        </span>,
        <span key="t" className={x.total ? "" : "text-warn"}>
          {x.total}
        </span>,
        <span key="r" className="truncate text-muted">
          {Object.entries(x.by_type)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ") || "—"}
        </span>,
        x.nights,
        <span key="o" className="text-muted">
          {x.off}
        </span>,
        x.swaps,
      ],
    }));
  } else {
    head = ["Nama & NIK", "Tipe", "Unit", "Mulai dinas", "Status", "Wajah"];
    cols = "grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]";
    rows = r.rows.map((x) => ({
      key: x.user_id,
      cells: [
        <span key="n" className="truncate font-medium">
          {x.name} · {x.employee_code}
        </span>,
        tipe(x.employment_type).label,
        <span key="u" className="truncate">
          {x.unit ?? "—"}
        </span>,
        x.period_start ? fmtDate(x.period_start) : "—",
        x.status === "aktif" ? "Aktif" : "Nonaktif",
        <span key="f" className={x.face ? "" : "text-warn"}>
          {x.face ? "Terdaftar" : "Belum daftar"}
        </span>,
      ],
    }));
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <span className="text-[15px] font-semibold">Pratinjau · {TAB_NAME[r.tab]}</span>
        <span className="text-[12.5px] font-medium text-faint">{unitLabel}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={cx("grid gap-3 border-b border-line px-5 py-3 text-xs font-medium text-faint", cols)}>
            {head.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
          {rows.slice(0, max).map((x) => (
            <div
              key={x.key}
              onClick={x.href ? () => router.push(x.href!) : undefined}
              className={cx("tnum grid items-center gap-3 border-b border-line2 px-5 py-[11px] text-[13px] font-medium", x.href && "cursor-pointer transition-colors hover:bg-hover", cols)}
            >
              {x.cells.map((c, i) => (
                <span key={i} className="min-w-0 truncate">
                  {c}
                </span>
              ))}
            </div>
          ))}
          {rows.length === 0 && <Empty />}
        </div>
      </div>
      <div className="tnum px-5 py-3.5 text-[12.5px] font-medium text-muted">
        {rows.length > max ? `Menampilkan ${max} dari ${rows.length} baris · ekspor untuk data lengkap` : `${rows.length} baris`}
      </div>
    </Card>
  );
}

function ExportModal({
  tab,
  recap,
  query,
  onClose,
  onDone,
}: {
  tab: Tab;
  recap: string;
  query: Record<string, string | undefined>;
  onClose: () => void;
  onDone: (x: ExportOut) => void;
}) {
  const [fmt, setFmt] = useState<"xlsx" | "pdf">("xlsx");
  const [off, setOff] = useState<Record<string, boolean>>({});
  const cols = COLS[tab].filter((c) => !(fmt === "pdf" && c === "Detail check in/out"));
  const chosen = cols.filter((c) => !off[c]);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api<ExportOut>("/api/v1/admin/reports/export", {
        body: { ...Object.fromEntries(Object.entries(query).filter(([, v]) => v && v !== "all")), format: fmt, columns: chosen },
      }),
    onSuccess: onDone,
    onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose} width={480} top={90}>
      <ModalHead title="Ekspor laporan" sub={recap} onClose={onClose} />
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Format</span>
        <Segmented
          value={fmt}
          onChange={setFmt}
          options={[
            { value: "xlsx", label: "Excel (.xlsx)" },
            { value: "pdf", label: "PDF" },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">
          Kolom yang disertakan <span className="font-medium text-faint">· {chosen.length} dipilih</span>
        </span>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {cols.map((c) => (
            <Checkbox key={c} on={!off[c]} onChange={() => setOff((o) => ({ ...o, [c]: !o[c] }))}>
              {c}
            </Checkbox>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 rounded-lg bg-soft px-3.5 py-3">
        <span className="text-xs font-medium text-faint">Rekap periode</span>
        <span className="text-sm font-medium">{recap}</span>
      </div>
      {err && <span className="text-[12.5px] font-medium text-bad">{err}</span>}
      <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
        <Button variant="outline" size="lg" onClick={onClose}>
          Batal
        </Button>
        <Button size="lg" disabled={chosen.length === 0} loading={m.isPending} onClick={() => m.mutate()}>
          <Download size={17} /> Ekspor
        </Button>
      </div>
    </Modal>
  );
}
