import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useSearchParams } from "@/lib/nav";
import { Suspense, useMemo, useState } from "react";
import { AttendanceDrawer } from "@/components/attendance-detail";
import { DateFilter, type DateRange } from "@/components/date-range";
import { PillTabs } from "@/components/pill-tabs";
import { Page } from "@/components/shell";
import { Card, Empty, ErrorState, LockedScope, PageHeader, Pager, Pill, SearchBox, Select, Skel, SortHead, Tag, useSort, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDayShort, fmtRange, todayWib } from "@/lib/format";
import { useMounted, useSession } from "@/lib/session";
import { DAY, tipe } from "@/lib/status";
import type { DailyRow, DayStatus, RangeRow, RangeSummary, StaffDay } from "@/lib/types";
import { inTimeColor, outTimeColor } from "@/lib/time-tone";

export const Route = createFileRoute("/_app/attendance")({ component: AbsensiPage });

/*
 * Satu hari  → satu baris per karyawan: Nama · Tipe · Unit · Check in · Check out · Status (klik = detail).
 * Lebih 1 hari → satu baris RINGKASAN per karyawan (Hadir/Terlambat/Izin-Sakit/Alpa); rincian harian
 *               dimuat hanya saat baris dibuka. Tidak ada baris karyawan × hari yang berulang, dan
 *               server tidak perlu mengirim N karyawan × M hari sekaligus.
 */

const PER_PAGE = 20;
const CHIPS: { k: string; label: string }[] = [
  { k: "all", label: "Semua" },
  { k: "hadir", label: "Hadir" },
  { k: "telat", label: "Terlambat" },
  { k: "belum", label: "Belum hadir" },
  { k: "izin", label: "Izin" },
  { k: "sakit", label: "Sakit" },
  { k: "gagal", label: "Verifikasi gagal" },
  { k: "tanpa_pulang", label: "Tanpa absen pulang" },
];
const match = (c: string, st: DayStatus) => c === "all" || (c === "hadir" ? st === "hadir" || st === "selesai" : c === "belum" ? st === "belum" || st === "alpa" : c === st);
const dayCols = "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_90px_90px_150px]";
const sumCols = "grid-cols-[28px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_repeat(4,76px)]";

function AbsensiPage() {
  return (
    <Suspense
      fallback={
        <Page>
          <Skel className="h-96 rounded-xl" />
        </Page>
      }
    >
      <Absensi />
    </Suspense>
  );
}

function Absensi() {
  const s = useSession();
  const sp = useSearchParams();
  const today = useMounted(() => todayWib());
  const [picked, setRange] = useState<DateRange | null>(null);
  const range: DateRange | null = picked ?? (today ? { from: today, to: today } : null);
  const single = !!range && range.from === range.to;
  const [chip, setChip] = useState(sp.get("chip") ?? "all");
  const [q, setQ] = useState("");
  const [fTipe, setTipe] = useState("all");
  const [unitSel, setUnit] = useState("all");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<{ userId: number; date: string | null } | null>(sp.get("detail") ? { userId: Number(sp.get("detail")), date: sp.get("date") } : null); // dari notifikasi: ?detail=<id>&date=<YYYY-MM-DD>
  const unit = s.lockedUnit ?? (unitSel === "all" ? undefined : unitSel);
  const reset = (fn: () => void) => (fn(), setPage(0));

  const daily = useQuery({
    queryKey: ["daily", unit, range?.to === today ? "today" : range?.to],
    queryFn: () => api<DailyRow[]>("/api/v1/admin/daily", { query: { unit, date: range!.to } }),
    enabled: !!range && single,
    refetchInterval: range?.to === today ? 60_000 : false,
  });
  const summary = useQuery({
    queryKey: ["attendance-summary", unit, range?.from, range?.to],
    queryFn: () => api<RangeSummary>("/api/v1/admin/attendance/summary", { query: { unit, from: range!.from ?? undefined, to: range!.to } }),
    enabled: !!range && !single,
  });

  const k = q.trim().toLowerCase();
  const keep = (r: { name: string; employee_code: string; employment_type: string | null }) =>
    (!k || r.name.toLowerCase().includes(k) || r.employee_code.toLowerCase().includes(k)) && (fTipe === "all" || r.employment_type === fTipe);
  const dayData = daily.data;
  const base = useMemo(() => (dayData ?? []).filter(keep), [dayData, k, fTipe]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayRows = base.filter((r) => match(chip, r.status));
  const sumRows = (summary.data?.rows ?? []).filter(keep);
  const day = useSort(dayRows, {
    name: (r) => r.name,
    tipe: (r) => tipe(r.employment_type).label.replace("—", ""),
    unit: (r) => r.unit,
    in: (r) => r.check_in,
    out: (r) => r.check_out,
    status: (r) => DAY[r.status].label,
  });
  const sum = useSort(sumRows, {
    name: (r) => r.name,
    tipe: (r) => tipe(r.employment_type).label.replace("—", ""),
    unit: (r) => r.unit,
    hadir: (r) => r.hadir,
    telat: (r) => r.telat,
    izin: (r) => r.izin + r.sakit,
    alpa: (r) => r.alpa,
  });
  const total = single ? dayRows.length : sumRows.length;
  const maxPage = Math.max(0, Math.ceil(total / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const loading = single ? daily.isLoading || !range : summary.isLoading;
  const error = single ? daily.error : summary.error;
  const shownRange = !single && summary.data ? { from: summary.data.start, to: summary.data.end } : null;

  return (
    <Page>
      {/* kiri: status (rekap 1 hari) · kanan: preset & rentang tanggal */}
      <PageHeader
        left={
          single && (
            <PillTabs
              label="Status kehadiran"
              value={chip}
              onChange={(v) => reset(() => setChip(v))}
              tabs={CHIPS.map((c) => ({ value: c.k, label: c.label, count: base.filter((r) => match(c.k, r.status)).length }))}
            />
          )
        }
        action={
          today &&
          range && (
            <DateFilter
              value={range}
              today={today}
              onChange={(r) => reset(() => setRange(r))}
              label={shownRange && !range.from ? fmtRange(shownRange.from, shownRange.to) : undefined}
            />
          )
        }
      />

      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => (single ? daily.refetch() : summary.refetch())} />
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <SearchBox value={q} onChange={(v) => reset(() => setQ(v))} className="sm:w-auto sm:flex-1" />
            <Select
              className="w-[150px] flex-none"
              value={fTipe}
              onChange={(v) => reset(() => setTipe(v))}
              options={[
                { value: "all", label: "Semua tipe" },
                { value: "magang", label: "Magang/PKL" },
                { value: "outsourcing", label: "Outsourcing" },
              ]}
            />
            {!s.lockedUnit ? (
              <Select
                className="w-[200px] flex-none"
                value={unitSel}
                onChange={(v) => reset(() => setUnit(v))}
                options={[{ value: "all", label: "Semua unit" }, ...s.units.map((u) => ({ value: u.name, label: u.name }))]}
              />
            ) : (
              s.can.unitFilter && <LockedScope label={s.lockedUnit} />
            )}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              {single ? (
                <>
                  <div className={cx("grid gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", dayCols)}>
                    <SortHead label="Nama" k="name" sort={day.sort} onSort={day.toggle} />
                    <SortHead label="Tipe" k="tipe" sort={day.sort} onSort={day.toggle} />
                    <SortHead label="Unit" k="unit" sort={day.sort} onSort={day.toggle} />
                    <SortHead label="Check in" k="in" sort={day.sort} onSort={day.toggle} />
                    <SortHead label="Check out" k="out" sort={day.sort} onSort={day.toggle} />
                    <SortHead label="Status" k="status" sort={day.sort} onSort={day.toggle} />
                  </div>
                  {loading && <SkeletonRows cols={dayCols} n={6} />}
                  {!loading &&
                    day.sorted.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE).map((r) => {
                      const S = DAY[r.status];
                      return (
                        <button
                          key={r.user_id}
                          onClick={() => setDetail({ userId: r.user_id, date: range!.to })}
                          className={cx("tnum grid w-full items-center gap-3 border-b border-line2 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-hover", dayCols)}
                        >
                          <NameCell name={r.name} code={r.employee_code} />
                          <span>
                            <Tag tone={tipe(r.employment_type)} />
                          </span>
                          <span className="truncate text-[13px] text-muted">{r.unit ?? "—"}</span>
                          <span className="text-[13px] font-medium" style={{ color: inTimeColor(r.in_diff_min) }}>
                            {r.check_in ?? "—"}
                          </span>
                          <span className="text-[13px] font-medium" style={{ color: outTimeColor(r.out_diff_min) }}>
                            {r.check_out ?? "—"}
                          </span>
                          <span>
                            <Pill tone={S}>{r.status === "telat" ? `Terlambat ${r.late_minutes} mnt` : S.label}</Pill>
                          </span>
                        </button>
                      );
                    })}
                </>
              ) : (
                <>
                  <div className={cx("grid gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", sumCols)}>
                    <span />
                    <SortHead label="Nama" k="name" sort={sum.sort} onSort={sum.toggle} />
                    <SortHead label="Tipe" k="tipe" sort={sum.sort} onSort={sum.toggle} />
                    <SortHead label="Unit" k="unit" sort={sum.sort} onSort={sum.toggle} />
                    <SortHead label="Hadir" k="hadir" sort={sum.sort} onSort={sum.toggle} align="right" />
                    <SortHead label="Terlambat" k="telat" sort={sum.sort} onSort={sum.toggle} align="right" />
                    <SortHead label="Izin/Sakit" k="izin" sort={sum.sort} onSort={sum.toggle} align="right" />
                    <SortHead label="Alpa" k="alpa" sort={sum.sort} onSort={sum.toggle} align="right" />
                  </div>
                  {loading && <SkeletonRows cols={sumCols} n={6} />}
                  {!loading &&
                    sum.sorted
                      .slice(cur * PER_PAGE, (cur + 1) * PER_PAGE)
                      .map((r) => <SummaryRow key={r.user_id} r={r} from={summary.data!.start} to={summary.data!.end} onDay={(date) => setDetail({ userId: r.user_id, date })} />)}
                </>
              )}
            </div>
          </div>
          {!loading && total === 0 && <Empty />}
          <Pager page={cur} total={total} perPage={PER_PAGE} onPage={setPage} />
        </Card>
      )}

      {today && <AttendanceDrawer userId={detail?.userId ?? null} date={detail?.date ?? today} onClose={() => setDetail(null)} />}
    </Page>
  );
}

function NameCell({ name, code }: { name: string; code: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[13.5px] font-medium">{name}</span>
      <span className="tnum text-xs text-muted">{code}</span>
    </span>
  );
}

function SkeletonRows({ cols, n }: { cols: string; n: number }) {
  return (
    <>
      {[...Array(n)].map((_, i) => (
        <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", cols)}>
          <Skel className="h-4 w-2/3" />
          <Skel className="h-4 w-16" />
          <Skel className="h-4 w-1/2" />
          <Skel className="h-4 w-12" />
          <Skel className="h-4 w-12" />
          <Skel className="h-5 w-20 rounded-md" />
        </div>
      ))}
    </>
  );
}

/** Baris ringkasan rentang; rincian harian diambil saat dibuka (dan di-cache per karyawan & rentang). */
function SummaryRow({ r, from, to, onDay }: { r: RangeRow; from: string; to: string; onDay: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const days = useQuery({
    queryKey: ["attendance-days", r.user_id, from, to],
    queryFn: () => api<StaffDay[]>("/api/v1/admin/attendance/days", { query: { user_id: r.user_id, from, to } }),
    enabled: open,
  });
  return (
    <div className="border-b border-line2 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cx("tnum grid w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover", sumCols, open && "bg-hover")}
      >
        <ChevronRight size={15} className={cx("text-muted transition-transform", open && "rotate-90")} />
        <NameCell name={r.name} code={r.employee_code} />
        <span>
          <Tag tone={tipe(r.employment_type)} />
        </span>
        <span className="truncate text-[13px] text-muted">{r.unit ?? "—"}</span>
        <span className="text-right text-[13px]">
          {r.hadir}
          <span className="text-faint">/{r.scheduled}</span>
        </span>
        <span className={cx("text-right text-[13px]", r.telat ? "text-warn" : "text-faint")}>{r.telat}</span>
        <span className={cx("text-right text-[13px]", r.izin + r.sakit ? "text-info" : "text-faint")}>{r.izin + r.sakit}</span>
        <span className={cx("text-right text-[13px]", r.alpa ? "text-bad" : "text-faint")}>{r.alpa}</span>
      </button>
      {open && (
        <div className="border-t border-line2 bg-soft/40 py-1 pl-11 pr-4">
          {days.isLoading && <Skel className="my-2 h-4 w-1/2" />}
          {days.data?.length === 0 && <Empty compact />}
          {days.data?.map((d) => {
            const S = DAY[d.status];
            return (
              <button
                key={d.date}
                onClick={() => onDay(d.date)}
                className="tnum grid w-full grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_90px_90px_150px] items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover"
              >
                <span className="font-medium">{fmtDayShort(d.date)}</span>
                <span className="truncate text-muted">{d.shift ? `Shift ${d.shift.name}` : "Tanpa jadwal"}</span>
                <span className="font-medium" style={{ color: inTimeColor(d.in_diff_min) }}>
                  {d.check_in ?? "—"}
                </span>
                <span className="font-medium" style={{ color: outTimeColor(d.out_diff_min) }}>
                  {d.check_out ?? "—"}
                </span>
                <span>
                  <Pill tone={S}>{d.status === "telat" ? `Terlambat ${d.late_minutes} mnt` : S.label}</Pill>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
