import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronRight, FileText, LogIn, LogOut, RefreshCw, Repeat2, ScanFace, Thermometer, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "../lib/nav";
import { AppGrid, HOME_APPS, useApps } from "../components/apps";
import { GradientHeader } from "../components/shell";
import { Avatar, Card, DateBadge, IconTile, Pill, PrimaryButton, Skel } from "../components/ui";
import { api, fileUrl } from "../lib/api";
import { attendanceGate } from "../lib/attendance-gate";
import { addDays, firstNames, fmtDateLong, fmtDayShort, fmtDistance, fmtMonth, fmtTime, greeting, hm, isoMonth, nowClock, todayWib } from "../lib/format";
import { diffFromShift, diffLabel, inTimeColor, outTimeColor } from "../lib/time-tone";
import { isFresh, useLocation } from "../lib/location";
import { useMe } from "../lib/session";
import type { Leave, Me, MonthSummary, ShiftDay, Swap } from "../lib/types";

export const avatarUrl = (u: Me["user"]) => (u.has_avatar ? fileUrl(`/users/${u.id}/avatar?v=${localStorage.getItem("abita.avatarV") ?? "0"}`) : null);

export function HomePage() {
  const me = useMe();
  const nav = useNavigate();
  const apps = useApps();
  const today = todayWib();
  const sum = useQuery({ queryKey: ["summary", isoMonth(today)], queryFn: () => api<MonthSummary>("/me/summary", { query: { month: isoMonth(today) } }) });
  const upcoming = useQuery({ queryKey: ["upcoming", today], queryFn: () => api<ShiftDay[]>("/me/shifts", { query: { from: addDays(today, 1), to: addDays(today, 10) } }) });
  const swaps = useQuery({ queryKey: ["swaps"], queryFn: () => api<Swap[]>("/me/swaps") });
  const leaves = useQuery({ queryKey: ["leaves"], queryFn: () => api<Leave[]>("/me/leaves") });
  if (!me.data) return null;
  const m = me.data;
  const u = m.user;
  const pendingSwaps = (swaps.data ?? []).filter((s) => s.status === "pending").sort((a, b) => Number(b.can_respond) - Number(a.can_respond));
  const pendingLeaves = (leaves.data ?? []).filter((l) => l.status === "pending");

  return (
    <div>
      <GradientHeader className="pb-[116px]">
        <div className="px-5 pt-3">
          <div className="flex items-center gap-3.5">
            <button type="button" onClick={() => nav("/profile")} aria-label="Profil">
              <Avatar name={u.name} src={avatarUrl(u)} onDark />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-white/80">{greeting()},</div>
              <div className="font-display truncate text-[20px] font-bold leading-tight">{firstNames(u.name)}</div>
            </div>
            <button type="button" aria-label="Notifikasi" onClick={() => nav("/notifications")} className="relative flex size-[46px] items-center justify-center rounded-full bg-white/14 active:bg-white/25">
              <Bell size={22} />
              {m.unread_notifications > 0 && <span className="absolute right-[11px] top-[10px] size-2.5 rounded-full border-2 border-[#0A6E79] bg-[#E5484D] dark:border-[#0d4a53]" />}
            </button>
          </div>
          <span className="mt-3.5 inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1.5 text-[13px] font-semibold">
            <span className="size-[7px] rounded-full bg-cyan-soft" />
            {u.employee_code}
          </span>
        </div>
      </GradientHeader>

      <div className="relative z-10 -mt-[96px] flex flex-col gap-4 px-4">
        <TodayCard me={m} />
        <Card pad={false} className="px-2 py-3.5">
          <AppGrid ids={HOME_APPS} onOpen={apps.open} more={() => nav("/apps")} />
        </Card>
        {pendingSwaps.slice(0, 1).map((s) => (
          <Pending
            key={s.id}
            icon={<Repeat2 size={20} />}
            title={s.can_respond ? `${s.name ?? "Rekan"} mengajak tukar shift` : s.stage === "peer" ? `Menunggu jawaban ${s.target_name ?? "rekan"}` : "Tukar shift menunggu Kepala Unit"}
            sub={s.summary}
            onClick={() => nav("/requests")}
          />
        ))}
        {pendingLeaves.slice(0, 1).map((l) => (
          <Pending key={l.id} icon={l.kind === "sakit" ? <Thermometer size={20} /> : <FileText size={20} />} title={`Pengajuan ${l.kind} menunggu`} sub={fmtDayShort(l.start_date)} onClick={() => nav("/requests")} />
        ))}
        {sum.data ? <Recap s={sum.data} onHistory={() => nav("/shift")} /> : <Skel className="h-[230px]" />}
        <Card>
          <div className="flex items-center">
            <span className="font-display flex-1 text-[16px] font-bold">Shift mendatang</span>
            <button type="button" onClick={() => nav("/shift")} className="flex items-center text-[13px] font-bold text-brand">
              Kelola <ChevronRight size={16} />
            </button>
          </div>
          {upcoming.isPending ? (
            <Skel className="mt-3 h-16" />
          ) : !upcoming.data?.length ? (
            <p className="py-3 text-[14px] text-muted">Belum ada jadwal shift berikutnya.</p>
          ) : (
            <div className="mt-1 divide-y divide-line">
              {upcoming.data.slice(0, 3).map((d) => (
                <ShiftRow key={d.date} d={d} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {apps.sheets}
    </div>
  );
}

/** Kartu utama: shift hari ini, jam besar, masuk/pulang, lokasi, tombol Check in / Check out. */
function TodayCard({ me }: { me: Me }) {
  const nav = useNavigate();
  const t = me.today;
  const [clock, setClock] = useState(nowClock());
  const [now, setNow] = useState(() => Date.now()); // jendela absen ikut diperbarui tanpa muat ulang
  useEffect(() => {
    const h = window.setInterval(() => (setClock(nowClock()), setNow(Date.now())), 10_000);
    return () => window.clearInterval(h);
  }, []);
  // Check in / check out hanya di dalam jendela waktu shift (lihat lib/attendance-gate.ts).
  // Di luar jendela / selesai / tanpa jadwal: tombol tetap ada tetapi tidak bisa ditekan, dengan keterangan.
  const gate = attendanceGate(t, now);
  const sh = t.shift?.shift;
  const inDiff = sh ? diffFromShift(t.check_in, t.work_date, sh.start_time, sh.end_time, "start") : null;
  const outDiff = sh ? diffFromShift(t.check_out, t.work_date, sh.start_time, sh.end_time, "end") : null;
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <div className="text-[13px] text-muted">{fmtDateLong(t.work_date)}</div>
      <div className="tnum mt-0.5 text-[16px] font-bold">{t.leave ? (t.leave === "sakit" ? "Sakit (disetujui)" : "Izin (disetujui)") : t.shift ? `${hm(t.shift.shift.start_time)} – ${hm(t.shift.shift.end_time)} WIB · ${t.shift.shift.name}` : "Tanpa jadwal"}</div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="font-display tnum text-[46px] font-bold leading-none">{clock}</span>
        <span className="text-[15px] font-semibold text-muted">WIB</span>
      </div>
      <div className="mt-4 grid grid-cols-2 divide-x divide-line rounded-[18px] bg-soft">
        <TimeCell icon={<LogIn size={18} />} label="Masuk" time={t.check_in} color={inTimeColor(inDiff)} sub={diffLabel(inDiff)} />
        <TimeCell icon={<LogOut size={18} />} label="Pulang" time={t.check_out} color={outTimeColor(outDiff)} sub={diffLabel(outDiff)} />
      </div>
      <LocationTile me={me} />
      <div className="mt-4">
        <PrimaryButton icon={<ScanFace size={19} />} disabled={!gate.can} onClick={() => nav("/attendance")}>
          {gate.purpose === "out" ? "Check out" : "Check in"}
        </PrimaryButton>
        {gate.hint && <p className={`mt-2 text-center text-[12.5px] ${gate.can ? "text-muted" : "text-warn"}`}>{gate.hint}</p>}
      </div>
    </Card>
  );
}

/** Jam masuk/pulang dengan warna terhadap jadwal (lib/time-tone.ts) dan selisihnya. */
function TimeCell({ icon, label, time, color, sub }: { icon: React.ReactNode; label: string; time: string | null; color?: string; sub?: string | null }) {
  return (
    <div className="flex items-center gap-2.5 p-3">
      <span className="flex size-9 items-center justify-center rounded-[12px] bg-card text-brand">{icon}</span>
      <span className="flex flex-col">
        <span className="text-[12px] text-muted">{label}</span>
        <span className={`tnum text-[16px] font-bold ${!time ? "text-faint" : "text-ink"}`} style={time && color ? { color } : undefined}>
          {fmtTime(time)}
          {time && sub && <span className="ml-1 whitespace-nowrap text-[11px] font-semibold">{sub}</span>}
        </span>
      </span>
    </div>
  );
}

function LocationTile({ me }: { me: Me }) {
  const { result: r, refresh } = useLocation(me.office);
  useEffect(() => {
    if (!isFresh()) void refresh();
  }, [refresh]);
  const [text, cls] =
    r.state === "valid" || r.state === "weak"
      ? [`Di dalam area · ${fmtDistance(r.distance)}`, "text-ok"]
      : r.state === "outside"
        ? [`Di luar area · ${fmtDistance(r.distance)}`, "text-bad"]
        : r.state === "permissionOff"
          ? ["Izin lokasi mati", "text-warn"]
          : r.state === "checking"
            ? ["Mengecek lokasi…", "text-muted"]
            : ["Lokasi tidak tersedia", "text-muted"];
  return (
    <button type="button" onClick={() => refresh()} className="mt-3 flex w-full items-center gap-3 rounded-[18px] border border-line p-2 pr-3 text-left active:bg-soft">
      <span className="relative flex size-[52px] items-center justify-center rounded-[14px] bg-bg">
        <span className="size-[38px] rounded-full border-[1.5px] border-brand bg-brand/12" />
        <span className="absolute size-[11px] rounded-full border-2 border-white bg-cyan" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">{me.office?.name ?? "Kantor belum diatur"}</span>
        <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${cls}`}>
          <span className="size-[7px] rounded-full bg-current" />
          {text}
        </span>
      </span>
      <RefreshCw size={17} className={`text-faint ${r.state === "checking" ? "animate-spin" : ""}`} />
    </button>
  );
}


function Pending({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="flex items-center gap-3">
      <IconTile icon={icon} tone="warn" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{title}</span>
        <span className="truncate text-[12.5px] text-muted">{sub}</span>
      </span>
      <Pill tone="warn">Diproses</Pill>
    </Card>
  );
}

function Recap({ s, onHistory }: { s: MonthSummary; onHistory: () => void }) {
  const ratio = s.scheduled_days ? Math.min(1, s.present / s.scheduled_days) : 0;
  const C = 2 * Math.PI * 43;
  const pct = s.punctuality_pct;
  return (
    <Card>
      <div className="flex items-center">
        <span className="font-display flex-1 text-[16px] font-bold">Rekap {fmtMonth(s.month)}</span>
        <button type="button" onClick={onHistory} className="flex items-center text-[13px] font-bold text-brand">
          Lihat riwayat <ChevronRight size={16} />
        </button>
      </div>
      <div className="mt-3.5 flex items-center gap-4">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 96 96" className="size-24 -rotate-90">
            <circle cx="48" cy="48" r="43" fill="none" strokeWidth="9" className="stroke-soft" />
            {ratio > 0 && <circle cx="48" cy="48" r="43" fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-ok" strokeDasharray={`${C * ratio} ${C}`} />}
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span>
              <span className="font-display text-[22px] font-bold">{s.present}</span>
              <span className="text-[12px] text-muted">/{s.scheduled_days}</span>
            </span>
            <span className="text-[10.5px] text-muted">hari hadir</span>
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Legend c="bg-ok" label="Tepat waktu" v={s.on_time} />
          <Legend c="bg-warn" label="Terlambat" v={s.late} />
          <Legend c="bg-purple" label="Izin / sakit" v={s.izin + s.sakit} />
          <Legend c="bg-bad" label="Alpa" v={s.absent} />
        </div>
      </div>
      <div className="mt-3.5 flex items-center border-t border-line pt-3">
        <span className="flex-1 text-[13px] text-muted">Ketepatan waktu bulan ini</span>
        <Pill tone={pct === null || pct >= 90 ? "ok" : "warn"} icon={pct !== null && pct >= 90 ? <TrendingUp size={13} /> : undefined}>
          {pct === null ? "—" : `${Math.round(pct)}%`}
        </Pill>
      </div>
    </Card>
  );
}

const Legend = ({ c, label, v }: { c: string; label: string; v: number }) => (
  <div className="flex items-center gap-2">
    <span className={`size-2 rounded-full ${c}`} />
    <span className="flex-1 text-[13px] text-muted">{label}</span>
    <span className="tnum font-bold">{v}</span>
  </div>
);

/** Baris jadwal: badge tanggal · nama shift · jam · status. */
export function ShiftRow({ d }: { d: ShiftDay }) {
  return (
    <div className="flex items-center gap-3.5 py-2.5">
      <DateBadge day={d.date} tone={d.pending_swap ? "warn" : "ok"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">Shift {d.shift.name}</span>
        <span className="tnum text-[13px] text-muted">
          {hm(d.shift.start_time)}–{hm(d.shift.end_time)} WIB
        </span>
      </span>
      {d.pending_swap ? <Pill tone="warn">Tukar diajukan</Pill> : <Pill>Terjadwal</Pill>}
    </div>
  );
}
