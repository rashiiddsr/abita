/** Kalender shift + riwayat: pilih tanggal untuk melihat jadwal dan jam masuk/pulang. */
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChartColumn, ChevronLeft, ChevronRight, Clock4, LogIn, LogOut, MapPin, Megaphone } from "lucide-react";
import { RecapSheet } from "../components/recap";
import { useState } from "react";
import { Card, cx, Pill, Skel, Title } from "../components/ui";
import { api } from "../lib/api";
import { addDays, fmtDateLong, fmtMonth, fmtTime, hm, isoMonth, lateMinutes, monthEnd, monthStart, shiftMonth, shiftStartIso, todayWib, weekday } from "../lib/format";
import { diffFromShift, diffLabel, inTimeColor, outTimeColor } from "../lib/time-tone";
import { useMe } from "../lib/session";
import type { Attendance, Leave, ShiftDay } from "../lib/types";

const NAMES = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export function ShiftPage() {
  const me = useMe();
  const today = todayWib();
  const [recap, setRecap] = useState(false);
  const [month, setMonth] = useState(isoMonth(today));
  const [selected, setSelected] = useState(today);
  const shifts = useQuery({ queryKey: ["shifts", month], queryFn: () => api<ShiftDay[]>("/me/shifts", { query: { from: monthStart(month), to: monthEnd(month) } }) });
  const att = useQuery({ queryKey: ["attendance", month], queryFn: () => api<Attendance[]>("/attendance/me", { query: { month } }) });
  const leaves = useQuery({ queryKey: ["leaves"], queryFn: () => api<Leave[]>("/me/leaves") });
  const sMap = new Map((shifts.data ?? []).map((s) => [s.date, s]));
  const ins = new Map((att.data ?? []).filter((a) => a.type === "in").map((a) => [a.work_date, a]));
  const outs = new Map((att.data ?? []).filter((a) => a.type === "out").map((a) => [a.work_date, a]));
  const approved = (leaves.data ?? []).filter((l) => l.status === "approved");
  const leaveOn = (d: string) => approved.find((l) => d >= l.start_date && d <= l.end_date)?.kind ?? null;

  const go = (n: number) => {
    const m = shiftMonth(month, n);
    setMonth(m);
    setSelected(m === isoMonth(today) ? today : monthStart(m));
  };
  const dot = (d: string): { attended?: boolean; c?: string } => {
    const i = ins.get(d);
    if (i) return { attended: true, c: (i.late_minutes ?? 0) > 0 ? "bg-warn" : "bg-[#14995A]" };
    if (leaveOn(d)) return { c: "bg-purple" };
    if (sMap.has(d)) return { c: d < today ? "bg-bad" : "bg-brand" };
    return {};
  };

  // grid Senin-awal
  const first = monthStart(month);
  const gridStart = addDays(first, -((weekday(first) + 6) % 7));
  const last = monthEnd(month);
  const weeks = Math.ceil((((weekday(first) + 6) % 7) + Number(last.slice(8))) / 7);
  const loading = shifts.isPending || att.isPending;

  return (
    <div className="animate-page px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <div className="flex items-center">
        <Title className="flex-1">Shift</Title>
        <button type="button" onClick={() => setRecap(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-brand-soft px-3.5 text-[13px] font-bold text-brand active:opacity-80">
          <ChartColumn size={16} />
          Rekap
        </button>
      </div>
      <div className="mt-3 flex items-start gap-3 rounded-[18px] bg-brand-soft p-3.5 text-brand">
        <Megaphone size={19} className="mt-0.5 shrink-0" />
        <span className="text-[13.5px] font-semibold">Tukar shift diajukan lewat menu Pengajuan.</span>
      </div>
      <Card className="mt-3">
        <div className="flex items-center">
          <span className="font-display flex-1 pl-1 text-[17px] font-bold">{fmtMonth(month)}</span>
          <button type="button" aria-label="Bulan sebelumnya" onClick={() => go(-1)} className="flex size-10 items-center justify-center rounded-full active:bg-soft">
            <ChevronLeft size={20} />
          </button>
          <button type="button" aria-label="Bulan berikutnya" onClick={() => go(1)} className="flex size-10 items-center justify-center rounded-full active:bg-soft">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-7 text-center text-[12px] font-semibold text-faint">
          {NAMES.map((n) => (
            <span key={n} className="py-1">
              {n}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i)).map((d) => {
            const inMonth = d.slice(0, 7) === month;
            const sel = d === selected;
            const info = inMonth ? dot(d) : {};
            const weekend = weekday(d) === 0 || weekday(d) === 6;
            return (
              <div key={d} className="p-[3px]">
                <button
                  type="button"
                  disabled={!inMonth}
                  onClick={() => setSelected(d)}
                  className={cx(
                    "flex aspect-square w-full flex-col items-center justify-center rounded-[14px] transition",
                    sel ? "bg-brand text-white" : info.attended ? "bg-ok-bg" : "active:bg-soft",
                    !inMonth && "text-line",
                    inMonth && !sel && (weekend && !info.c ? "text-faint" : "text-ink"),
                  )}
                >
                  <span className={cx("text-[15px]", d === today || sel ? "font-extrabold" : "font-medium")}>{Number(d.slice(8))}</span>
                  <span className={cx("mt-[3px] size-[5px] rounded-full", info.c ? (sel ? "bg-white" : info.c) : "bg-transparent")} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-2.5 flex flex-wrap justify-center gap-x-3.5 gap-y-1.5 text-[12px] text-muted">
          <Legend c="bg-[#14995A]" t="Hadir" />
          <Legend c="bg-warn" t="Terlambat" />
          <Legend c="bg-purple" t="Izin/Sakit" />
          <Legend c="bg-bad" t="Tidak hadir" />
          <Legend c="bg-brand" t="Terjadwal" />
        </div>
      </Card>
      <div className="mt-3.5">{loading ? <Skel className="h-52" /> : <DayDetail date={selected} today={today} shift={sMap.get(selected)} inA={ins.get(selected)} outA={outs.get(selected)} leave={leaveOn(selected)} office={me.data?.office?.name} />}</div>
      <RecapSheet open={recap} onClose={() => setRecap(false)} />
    </div>
  );
}

const Legend = ({ c, t }: { c: string; t: string }) => (
  <span className="flex items-center gap-1.5">
    <span className={`size-[7px] rounded-full ${c}`} />
    {t}
  </span>
);

function DayDetail({ date, today, shift, inA, outA, leave, office }: { date: string; today: string; shift?: ShiftDay; inA?: Attendance; outA?: Attendance; leave: string | null; office?: string }) {
  const past = date < today;
  const isToday = date === today;
  const st = shift?.shift;
  // selisih terhadap jadwal: warna jam masuk & pulang (lib/time-tone.ts)
  const late = st ? lateMinutes(inA?.checked_at, shiftStartIso(date, st.start_time)) : 0;
  const inDiff = st ? diffFromShift(inA?.checked_at, date, st.start_time, st.end_time, "start") : null;
  const outDiff = st ? diffFromShift(outA?.checked_at, date, st.start_time, st.end_time, "end") : null;
  const [status, tone] = ((): [string, "purple" | "warn" | "ok" | "muted" | "bad" | "brand"] => {
    if (leave) return [leave === "sakit" ? "Sakit" : "Izin", "purple"];
    if (inA && !outA && past) return ["Tanpa absen pulang", "warn"];
    if (inA && late > 0) return [`Terlambat ${late} mnt`, late >= 60 ? "bad" : "warn"];
    if (inA) return ["Hadir", "ok"];
    if (!st) return ["Libur", "muted"];
    if (past) return ["Tidak hadir", "bad"];
    if (shift!.pending_swap) return ["Tukar diajukan", "warn"];
    if (isToday) return ["Hari ini", "brand"];
    return ["Terjadwal", "brand"];
  })();
  const showTimes = past || (isToday && !!inA);
  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-[17px] font-bold">Agenda Shift</span>
          <span className="text-[13px] text-muted">{fmtDateLong(date)}</span>
        </span>
        <Pill tone={tone}>{status}</Pill>
      </div>
      <div className="mt-2.5 border-t border-line pt-1">
        <Row icon={<CalendarClock size={18} />} k="Shift" v={st?.name ?? "Libur"} />
        {st && (
          <>
            <Row icon={<Clock4 size={18} />} k="Jam kerja" v={`${hm(st.start_time)} – ${hm(st.end_time)}`} />
            {office && <Row icon={<MapPin size={18} />} k="Lokasi" v={office} />}
            {showTimes && (
              <>
                <Row icon={<LogIn size={18} />} k="Masuk" v={fmtTime(inA?.checked_at)} color={inTimeColor(inDiff)} sub={inA ? diffLabel(inDiff) : null} />
                <Row icon={<LogOut size={18} />} k="Pulang" v={fmtTime(outA?.checked_at)} color={outTimeColor(outDiff)} sub={outA ? diffLabel(outDiff) : null} />
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

const Row = ({ icon, k, v, color, sub }: { icon: React.ReactNode; k: string; v: string; color?: string; sub?: string | null }) => (
  <div className="flex items-center gap-3 py-2.5">
    <span className="text-faint">{icon}</span>
    <span className="text-[14px] text-muted">{k}</span>
    <span className="tnum flex-1 text-right text-[14px] font-semibold text-ink" style={color ? { color } : undefined}>
      {v}
      {sub && <span className="ml-1 text-[11px]">{sub}</span>}
    </span>
  </div>
);
