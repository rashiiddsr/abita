import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight } from "lucide-react";
import { useRouter } from "@/lib/nav";
import { Page } from "@/components/shell";
import { Card, ErrorState, LinkBtn, Pill, Skel, VerifMark, cx, Empty } from "@/components/ui";
import { menuOf } from "@/lib/access";
import { api } from "@/lib/api";
import { firstName, fmtDate, fmtDateLong, greeting, hoursSince, nowWibTime, todayWib } from "@/lib/format";
import { useMounted, useScopeUnit, useSession } from "@/lib/session";
import { DAY, shiftTone, toneStyle } from "@/lib/status";
import type { DailyRow, Dashboard, LeaveOut, ScheduleMonth, SwapOut, User } from "@/lib/types";
import { inTimeColor, outTimeColor } from "@/lib/time-tone";

export const Route = createFileRoute("/_app/dashboard")({ component: DashboardPage });

const COL = [
  { k: "hadir", l: "Hadir", c: "#14995A" },
  { k: "telat", l: "Terlambat", c: "#D98A00" },
  { k: "izin", l: "Izin", c: "#4F5BD5" },
  { k: "sakit", l: "Sakit", c: "#E0787A" },
  { k: "belum", l: "Belum hadir / alpa", c: "var(--color-off)" },
] as const;

type Seg = Record<(typeof COL)[number]["k"], number>;

function SegBar({ o, unit }: { o: Seg; unit: string }) {
  const tot = COL.reduce((a, c) => a + o[c.k], 0) || 1;
  return (
    <span className="flex h-3.5 gap-0.5 overflow-hidden rounded">
      {COL.map((c) =>
        o[c.k] > 0 ? <span key={c.k} title={`${c.l}: ${o[c.k]}${unit}`} style={{ width: `${(o[c.k] / tot) * 100}%`, background: c.c }} /> : null,
      )}
    </span>
  );
}

function DashboardPage() {
  const router = useRouter();
  const s = useSession();
  const unit = useScopeUnit();
  const clock = useMounted(() => ({ today: todayWib(), time: nowWibTime(), greet: greeting() }));

  const dash = useQuery({ queryKey: ["dashboard", unit], queryFn: () => api<Dashboard>("/api/v1/admin/dashboard", { query: { unit } }), refetchInterval: 60_000 });
  const mon = s.can.monitor;
  const daily = useQuery({ queryKey: ["daily", unit, "today"], queryFn: () => api<DailyRow[]>("/api/v1/admin/daily", { query: { unit } }), refetchInterval: 60_000, enabled: mon });
  const leaves = useQuery({ queryKey: ["leaves", "pending"], queryFn: () => api<LeaveOut[]>("/api/v1/admin/leaves", { query: { status: "pending" } }), enabled: mon });
  const swaps = useQuery({ queryKey: ["swaps", "pending", unit], queryFn: () => api<SwapOut[]>("/api/v1/admin/swaps", { query: { status: "pending", unit } }), enabled: mon });
  const plan = useQuery({ queryKey: ["schedule", "next"], queryFn: () => api<ScheduleMonth>("/api/v1/admin/schedule"), enabled: mon });
  const staff = useQuery({ queryKey: ["users", "staff"], queryFn: () => api<User[]>("/api/v1/admin/users", { query: { role: "staff" } }) });

  if (dash.isError) return <Page><ErrorState message={(dash.error as Error).message} onRetry={() => dash.refetch()} /></Page>;
  const d = dash.data;
  const rows = daily.data ?? [];
  const T = d?.totals;
  const scopeLabel = unit ?? "Semua unit";
  const toAbs = (chip?: string) => router.push(chip ? `/attendance?chip=${chip}` : "/attendance");
  const allowed = (href: string) => s.can.menus.has(menuOf(href.split("?")[0]));

  return (
    <Page className="gap-5">
      {/* hero */}
      <div className="flex flex-wrap items-end justify-between gap-6 px-0.5 pb-0.5 pt-1.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-2xl font-semibold">
            {clock?.greet ?? "Halo"}, {firstName(s.me.user.name)}
          </span>
          <span className="tnum text-sm font-normal text-muted">
            {clock ? `${fmtDateLong(clock.today)} · ${clock.time} WIB · ` : ""}
            {scopeLabel}
          </span>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-[300px]">
          <div className="flex items-baseline gap-1.5 sm:justify-end">
            <span className="tnum text-[30px] font-semibold leading-none">{T ? T.hadir : "–"}</span>
            <span className="tnum text-[15px] font-medium text-faint">/ {T ? T.scheduled : "–"}</span>
            <span className="text-[13.5px] font-medium text-muted">hadir hari ini</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-line">
            <div className="h-full rounded-[3px] bg-brand transition-[width] duration-500" style={{ width: T && T.scheduled ? `${(T.hadir / T.scheduled) * 100}%` : "0%" }} />
          </div>
        </div>
      </div>

      {!d ? (
        <DashSkeleton />
      ) : T!.scheduled === 0 && T!.staff === 0 ? (
        <Card className="flex flex-col items-center gap-2.5 px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <CalendarClock size={26} />
          </span>
          <span className="mt-1.5 text-lg font-semibold">Belum ada data kehadiran hari ini</span>
          {allowed("/schedule") && (
            <button onClick={() => router.push("/schedule")} className="mt-2.5 h-11 rounded-lg bg-brand-soft px-[18px] text-sm font-medium text-brand">
              Lihat jadwal hari ini
            </button>
          )}
        </Card>
      ) : (
        <>
          {/* strip KPI */}
          <Card className="grid grid-cols-3 overflow-hidden lg:grid-cols-6">
            {[
              { label: "Total karyawan", short: "Total", v: T!.staff, dot: "#97A1B0", chip: "all" },
              { label: "Hadir", v: T!.hadir, dot: "#14995A", chip: "hadir" },
              { label: "Terlambat", v: T!.telat, dot: "#D98A00", chip: "telat" },
              { label: "Belum hadir", short: "Belum", v: T!.belum, dot: "#C82829", chip: "belum" },
              { label: "Izin", v: T!.izin, dot: "#4F5BD5", chip: "izin" },
              { label: "Sakit", v: T!.sakit, dot: "#C82829", chip: "sakit" },
            ].map((k, i) => (
              <button
                key={k.label}
                onClick={() => toAbs(k.chip)}
                disabled={!mon}
                className={cx(
                  "flex min-w-0 flex-col gap-1.5 bg-card px-4 py-4 text-left transition-colors enabled:hover:bg-soft enabled:active:bg-skel disabled:cursor-default lg:px-5 lg:py-[18px]",
                  i % 3 && "border-l border-line",
                  i > 2 && "border-t border-line lg:border-t-0",
                  i === 3 && "lg:border-l",
                )}
              >
                <span className="flex items-center gap-[7px] truncate text-[13px] font-medium text-muted">
                  <span className="size-2 flex-none rounded-full" style={{ background: k.dot }} />
                  <span className="sm:hidden">{k.short ?? k.label}</span>
                  <span className="hidden sm:inline">{k.label}</span>
                </span>
                <span className="tnum text-[28px] font-semibold">{k.v}</span>
              </button>
            ))}
          </Card>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <UnitDistribution d={d} unit={unit} onUnit={s.can.unitFilter ? (u) => s.setScope(u) : undefined} report={allowed("/reports")} />
              {s.isHead && <ShiftsToday rows={rows} onManage={() => router.push("/schedule")} />}
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <Attention
                d={d}
                rows={rows}
                leaves={(leaves.data ?? []).filter((l) => !unit || l.unit === unit)}
                swaps={(swaps.data ?? []).filter((w) => w.can_review)}
                noFace={(staff.data ?? []).filter((u) => u.is_active !== false && !u.face_enrolled_at && (!unit || u.unit === unit))}
                review={s.can.review}
                allowed={allowed}
                go={(href) => router.push(href)}
              />
              {plan.data && clock && <SchedulePlan m={plan.data} today={clock.today} unit={unit} head={s.isHead} go={(href) => router.push(href)} />}
            </div>
          </div>

          {mon && <AttendanceLog rows={rows} loading={daily.isLoading} onAll={() => toAbs()} onOpen={(r) => router.push(`/attendance?detail=${r.user_id}`)} />}
        </>
      )}
    </Page>
  );
}

function DashSkeleton() {
  return (
    <>
      <Card className="grid h-24 grid-cols-6 gap-5 p-5">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex flex-col gap-2.5">
            <Skel className="h-3 w-3/5" />
            <Skel className="h-6 w-2/5 rounded-lg" />
          </div>
        ))}
      </Card>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="flex h-[420px] flex-col gap-3.5 p-[22px]">
          <Skel className="h-4 w-[200px]" />
          <Skel className="flex-1 rounded-lg bg-soft" />
        </Card>
        <Card className="flex h-[420px] flex-col gap-4 p-[22px]">
          <Skel className="h-4 w-[140px]" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skel className="size-[38px] flex-none rounded-xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Skel className="h-[11px] w-4/5" />
                <Skel className="h-2.5 w-1/2 bg-soft" />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function UnitDistribution({ d, unit, onUnit, report }: { d: Dashboard; unit?: string; onUnit?: (u: string) => void; report: boolean }) {
  const seg = (u: { hadir: number; telat: number; izin: number; sakit: number; belum: number }): Seg => ({
    hadir: u.hadir - u.telat,
    telat: u.telat,
    izin: u.izin,
    sakit: u.sakit,
    belum: u.belum,
  });
  const base = (u: { hadir: number; izin: number; sakit: number; belum: number }) => u.hadir + u.izin + u.sakit + u.belum;
  const p = (u: { hadir: number; izin: number; sakit: number; belum: number }) => (base(u) ? Math.round((u.hadir / base(u)) * 100) : 0);
  let rows: { name: string; strong?: boolean; seg: Seg; pct: number; cnt: string; onClick?: () => void; isPct?: boolean }[];
  let insight = "";
  if (!unit) {
    const all = d.units.reduce((a, u) => ({ hadir: a.hadir + u.hadir, telat: a.telat + u.telat, izin: a.izin + u.izin, sakit: a.sakit + u.sakit, belum: a.belum + u.belum }), { hadir: 0, telat: 0, izin: 0, sakit: 0, belum: 0 });
    const withSched = d.units.filter((u) => base(u) > 0);
    rows = [
      { name: "Semua unit", strong: true, seg: seg(all), pct: p(all), cnt: `${all.hadir} / ${base(all)}` },
      ...withSched.map((u) => ({ name: u.name, seg: seg(u), pct: p(u), cnt: `${u.hadir} / ${base(u)}`, onClick: u.name === "Tanpa unit" || !onUnit ? undefined : () => onUnit(u.name) })),
    ];
    const low = [...withSched].sort((a, b) => p(a) - p(b))[0];
    if (low) insight = `${low.name} terendah hari ini: ${p(low)}% hadir, ${low.belum} belum check in.`;
  } else {
    const u = d.units.find((x) => x.name === unit) ?? { hadir: 0, telat: 0, izin: 0, sakit: 0, belum: 0 };
    const past = d.trend.slice(0, -1).filter((t) => t.scheduled > 0);
    const avg = (k: "hadir" | "telat" | "izin" | "sakit" | "alpa") => (past.length ? past.reduce((a, t) => a + t[k] / t.scheduled, 0) / past.length : 0) * 100;
    const pastSeg: Seg = { hadir: Math.round(avg("hadir") - avg("telat")), telat: Math.round(avg("telat")), izin: Math.round(avg("izin")), sakit: Math.round(avg("sakit")), belum: Math.round(avg("alpa")) };
    const today = p(u);
    const avgP = Math.round(avg("hadir"));
    rows = [
      { name: "Hari ini", strong: true, seg: seg(u), pct: today, cnt: `${u.hadir} / ${base(u)}` },
      { name: `${past.length} hari sebelumnya`, seg: pastSeg, pct: avgP, cnt: "rata-rata", isPct: true },
    ];
    insight = past.length ? `Hari ini ${today}% hadir, ${today >= avgP ? `${today - avgP} poin di atas` : `${avgP - today} poin di bawah`} rata-rata ${past.length} hari terakhir.` : "";
  }
  return (
    <Card className="px-[22px] py-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-[3px]">
          <span className="text-base font-semibold">{unit ? `Kehadiran ${unit}` : "Status kehadiran per unit"}</span>
          <span className="text-[12.5px] font-normal text-muted">{unit ? "Hari ini dibanding hari-hari sebelumnya" : "Hari ini · persentase dari karyawan berjadwal tiap unit"}</span>
        </div>
        {report && (
          <a href="/reports" className="flex flex-none items-center gap-0.5 py-1 text-[13px] font-medium text-brand active:opacity-60">
            Laporan
            <ChevronRight size={16} />
          </a>
        )}
      </div>
      <div className="grid grid-cols-[minmax(90px,200px)_minmax(0,1fr)_52px_64px] gap-3.5 pb-2 text-[11.5px] font-medium text-faint">
        <span />
        <span />
        <span className="text-right">% hadir</span>
        <span className="text-right">Hadir</span>
      </div>
      {rows.map((r, i) => (
        <button
          key={r.name}
          onClick={r.onClick}
          disabled={!r.onClick}
          className={cx(
            "grid w-full grid-cols-[minmax(90px,200px)_minmax(0,1fr)_52px_64px] items-center gap-3.5 text-left hover:opacity-85 disabled:cursor-default",
            i === 0 ? "border-b border-line pb-3.5" : "pt-3",
          )}
        >
          <span className={cx("truncate text-[13.5px]", r.strong ? "font-semibold" : "font-medium")}>{r.name}</span>
          <SegBar o={r.seg} unit={r.isPct ? "%" : " orang"} />
          <span className={cx("tnum text-right text-sm font-semibold", r.pct < 80 && !r.strong ? "text-warn" : "text-ink")}>{r.pct}%</span>
          <span className="tnum text-right text-[12.5px] font-medium text-muted">{r.cnt}</span>
        </button>
      ))}
      <div className="mt-[18px] flex flex-wrap items-center justify-between gap-4 border-t border-line pt-3.5">
        <div className="flex flex-wrap gap-3.5 text-xs font-medium text-muted">
          {COL.map((c) => (
            <span key={c.k} className="flex items-center gap-1.5">
              <span className="size-[9px] rounded-sm" style={{ background: c.c }} />
              {c.l}
            </span>
          ))}
        </div>
        {insight && <span className="text-[12.5px] font-medium">{insight}</span>}
      </div>
    </Card>
  );
}

function ShiftsToday({ rows, onManage }: { rows: DailyRow[]; onManage: () => void }) {
  const by = new Map<string, { name: string; start: string; end: string; color: string | null; staff: number; done: number; missing: number; started: boolean }>();
  const now = useMounted(() => nowWibTime());
  for (const r of rows) {
    if (!r.shift) continue;
    const k = r.shift.name;
    const cur = by.get(k) ?? { name: k, start: r.shift.start, end: r.shift.end, color: r.shift.color, staff: 0, done: 0, missing: 0, started: false };
    cur.staff++;
    if (r.check_in) cur.done++;
    if (r.status === "belum" || r.status === "gagal") cur.missing++;
    by.set(k, cur);
  }
  const list = [...by.values()].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <Card className="px-[22px] pb-2 pt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-base font-semibold">Shift hari ini</span>
        <LinkBtn onClick={onManage}>
          Kelola jadwal <ChevronRight size={16} />
        </LinkBtn>
      </div>
      {list.length === 0 && <Empty compact />}
      {list.map((r, i) => {
        const t = shiftTone(r.name, r.color);
        const started = now ? now >= r.start || r.start > r.end : false;
        const st = !started ? { l: "Belum mulai", bg: "#F4F6F8", c: "#5B6678" } : r.missing ? { l: `${r.missing} belum hadir`, bg: "#FFF3D9", c: "#8A5600" } : { l: "Berlangsung", bg: "#E3F5EA", c: "#14995A" };
        return (
          <div key={r.name} className={cx("flex items-center gap-3.5 py-3.5", i < list.length - 1 && "border-b border-line")}>
            <span className="flex size-[52px] flex-none items-center justify-center rounded-lg text-[13px] font-semibold" style={toneStyle(t.bg, t.fg)}>
              {t.code}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium">Shift {r.name}</span>
              <span className="tnum text-[13px] font-normal text-muted">
                {r.start}–{r.end} · {r.staff} staf
              </span>
            </div>
            <div className="hidden w-[180px] flex-col gap-1.5 sm:flex">
              <span className="tnum text-right text-[12.5px] font-medium text-muted">
                {r.done} / {r.staff} check in
              </span>
              <span className="h-1.5 overflow-hidden rounded-[3px] bg-skel">
                <span className="block h-full rounded-[3px] bg-brand" style={{ width: `${(r.done / r.staff) * 100}%` }} />
              </span>
            </div>
            <span className="inline-flex w-[118px] flex-none items-center justify-center gap-1.5 rounded-full px-2.5 py-[5px] text-xs font-medium" style={toneStyle(st.bg, st.c)}>
              <span className="size-1.5 rounded-full bg-current" />
              {st.l}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function Attention({
  d,
  rows,
  leaves,
  swaps,
  noFace,
  review,
  allowed,
  go,
}: {
  d: Dashboard;
  rows: DailyRow[];
  leaves: LeaveOut[];
  swaps: SwapOut[];
  noFace: User[];
  review: boolean;
  allowed: (href: string) => boolean;
  go: (href: string) => void;
}) {
  const A = { amber: ["#FFF3D9", "#8A5600"], red: ["#FDECEC", "#C82829"], grey: ["#F4F6F8", "#5B6678"] } as const;
  const late24 = leaves.filter((l) => hoursSince(l.created_at) >= 24);
  const gagal = rows.filter((r) => r.status === "gagal");
  // Kepala Unit: yang perlu ia putuskan; Admin SDM: semua yang masih menunggu (pemantauan)
  const mine = review ? leaves.filter((l) => l.can_review) : leaves;
  const items = [
    mine.length > 0 && {
      n: mine.length,
      title: review ? "Pengajuan menunggu keputusan" : "Pengajuan menunggu Kepala Unit",
      sub: late24.length ? `${late24.length} lewat 24 jam · terlama ${Math.floor(Math.max(...late24.map((l) => hoursSince(l.created_at))) / 24)} hari` : "Semua masuk kurang dari 24 jam",
      tone: late24.length ? A.amber : A.grey,
      act: review ? "Tinjau" : "Lihat",
      href: "/requests",
    },
    gagal.length > 0 && {
      n: gagal.length,
      title: "Verifikasi gagal hari ini",
      sub: gagal.map((r) => `${firstName(r.name)}: ${(r.location_note ?? r.face_note ?? "gagal").split(" ·")[0].toLowerCase()}`).join(" · "),
      tone: A.red,
      act: "Periksa",
      href: "/attendance?chip=gagal",
    },
    d.totals.belum > 0 && { n: d.totals.belum, title: "Belum check in", sub: "Shift sudah dimulai · cek izin atau hubungi unit", tone: A.grey, act: "Lihat", href: "/attendance?chip=belum" },
    review && swaps.length > 0 && { n: swaps.length, title: "Tukar shift menunggu", sub: swaps.map((w) => `${firstName(w.name ?? "")} · ${w.date.slice(8)}/${w.date.slice(5, 7)}`).join(", "), tone: A.amber, act: "Tinjau", href: "/requests" },
    noFace.length > 0 && { n: noFace.length, title: "Belum daftar wajah", sub: `${noFace.slice(0, 4).map((u) => firstName(u.name)).join(", ")}${noFace.length > 4 ? "…" : ""}`, tone: A.amber, act: "Lihat", href: "/staff" },
  ].filter((x) => x && allowed(x.href)) as { n: number; title: string; sub: string; tone: readonly [string, string]; act: string; href: string }[];
  return (
    <Card className="px-5 pb-2 pt-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-base font-semibold">Perlu perhatian</span>
        <span className="tnum text-[12.5px] font-medium text-faint">{items.reduce((a, x) => a + x.n, 0)} item</span>
      </div>
      {items.map((a, i) => (
        <div key={a.title} className={cx("flex items-start gap-3 py-3", i < items.length - 1 && "border-b border-line2")}>
          <span className="tnum flex h-9 min-w-9 flex-none items-center justify-center rounded-xl px-2 text-[15px] font-semibold" style={toneStyle(a.tone[0], a.tone[1])}>
            {a.n}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">{a.title}</span>
            <span className="text-[12.5px] font-normal leading-[1.4] text-muted">{a.sub}</span>
          </span>
          <button onClick={() => go(a.href)} className="h-8 flex-none rounded-lg bg-soft px-3 text-[12.5px] font-medium hover:bg-brand-soft hover:text-brand active:scale-95">
            {a.act}
          </button>
        </div>
      ))}
      {items.length === 0 && <Empty compact />}
    </Card>
  );
}

/** Status jadwal bulan depan: Kepala Unit melihat unitnya + tombol susun; Admin SDM memantau semua unit. */
function SchedulePlan({ m, today, unit, head, go }: { m: ScheduleMonth; today: string; unit?: string; head: boolean; go: (href: string) => void }) {
  const units = m.units.filter((u) => !unit || u.unit === unit);
  if (!units.length) return null;
  const done = units.filter((u) => u.status === "published").length;
  const late = today > m.deadline;
  const days = Math.round((Date.parse(m.deadline) - Date.parse(today)) / 86_400_000);
  const due = late ? `Lewat batas ${fmtDate(m.deadline)}` : days === 0 ? "Batas hari ini" : `Batas ${fmtDate(m.deadline)} · ${days} hari lagi`;
  return (
    <Card className="px-5 pb-2 pt-5">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">Jadwal {m.label}</span>
          <span className={cx("tnum text-[12.5px]", late && done < units.length ? "text-bad" : "text-muted")}>{due}</span>
        </div>
        {!head && (
          <span className="tnum text-[12.5px] font-medium text-faint">
            {done}/{units.length} terbit
          </span>
        )}
      </div>
      {units.map((u, i) => {
        const pub = u.status === "published";
        return (
          <div key={u.unit} className={cx("flex items-center gap-3 py-3", i < units.length - 1 && "border-b border-line2")}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{head ? (pub ? "Sudah terbit" : "Draf") : u.unit}</span>
              <span className="tnum text-[12.5px] text-muted">
                {u.scheduled_staff}/{u.staff} karyawan terjadwal · {u.shifts} shift
              </span>
            </span>
            {head ? (
              <button onClick={() => go(`/schedule?month=${m.month}`)} className="h-8 flex-none rounded-lg bg-soft px-3 text-[12.5px] font-medium hover:bg-brand-soft hover:text-brand">
                {pub ? "Lihat" : "Susun"}
              </button>
            ) : (
              <Pill tone={pub ? { label: "Terbit", bg: "#E3F5EA", fg: "#14995A" } : late ? { label: "Terlambat", bg: "#FDECEC", fg: "#C82829" } : { label: "Draf", bg: "#FFF3D9", fg: "#8A5600" }} />
            )}
          </div>
        );
      })}
    </Card>
  );
}

function AttendanceLog({ rows, loading, onAll, onOpen }: { rows: DailyRow[]; loading: boolean; onAll: () => void; onOpen: (r: DailyRow) => void }) {
  const last = (r: DailyRow) => r.check_out ?? r.check_in ?? "";
  const list = rows.filter((r) => r.check_in || r.status === "gagal").sort((a, b) => last(b).localeCompare(last(a))).slice(0, 7);
  const cols = "grid-cols-[minmax(0,1.8fr)_minmax(0,1.5fr)_minmax(0,.6fr)_minmax(0,.6fr)_minmax(0,.6fr)_minmax(0,1.1fr)_minmax(0,1fr)]";
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-3 pt-[18px]">
        <span className="text-base font-semibold">Log kehadiran</span>
        <LinkBtn onClick={onAll}>
          Semua di Absensi <ChevronRight size={16} />
        </LinkBtn>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className={cx("grid gap-3 border-y border-line px-5 py-2.5 text-xs font-medium text-faint", cols)}>
            <span>Karyawan</span>
            <span>Unit</span>
            <span>Shift</span>
            <span>Masuk</span>
            <span>Pulang</span>
            <span>Status</span>
            <span>Verifikasi</span>
          </div>
          {loading && <div className="px-5 py-6 text-sm text-muted">Memuat…</div>}
          {!loading && list.length === 0 && <Empty compact />}
          {list.map((x, i) => {
            const S = DAY[x.status];
            const has = !!x.check_in || x.status === "gagal";
            return (
              <button
                key={x.user_id}
                onClick={() => onOpen(x)}
                className={cx("tnum grid w-full items-center gap-3 bg-card px-5 py-[11px] text-left text-[13px] font-medium hover:bg-hover", cols, i < list.length - 1 && "border-b border-line2")}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-medium">{x.name}</span>
                  <span className="text-xs text-faint">{x.employee_code}</span>
                </span>
                <span className="truncate text-muted">{x.unit ?? "—"}</span>
                <span className="text-muted">{x.shift?.name ?? "—"}</span>
                <span className="font-medium" style={{ color: inTimeColor(x.in_diff_min) }}>
                  {x.check_in ?? "—"}
                </span>
                <span className="font-medium" style={{ color: outTimeColor(x.out_diff_min) }}>
                  {x.check_out ?? "—"}
                </span>
                <span>
                  <Pill tone={S}>{x.status === "telat" ? `Terlambat ${x.late_minutes} mnt` : S.label}</Pill>
                </span>
                <span className="flex gap-2.5">
                  {has ? (
                    <>
                      <VerifMark ok={x.location_ok !== false} label="Lokasi" tip={x.location_note ?? (x.distance_m != null ? `${Math.round(x.distance_m)} m dari titik` : "")} />
                      <VerifMark ok={x.face_ok !== false} label="Wajah" tip={x.face_note ?? (x.match_score != null ? `Cocok ${(x.match_score * 100).toFixed(1)}%` : "")} />
                    </>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
