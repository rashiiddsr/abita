import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronLeft, ChevronRight, CircleAlert, FileText, GraduationCap, KeyRound, PencilLine, Power, ScanFace, ShieldCheck, Stethoscope } from "lucide-react";
import { useParams, useRouter } from "@/lib/nav";
import { useState } from "react";
import { Page, useCrumb } from "@/components/shell";
import { StaffFiles } from "@/components/files";
import { useStaffActions } from "@/components/staff-actions";
import { Button, Card, ErrorState, Field, Pager, Pill, Skel, cx, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { DAY3, daysBetween, fmtDate, fmtDayShort, fmtMonth, initials, parseDate, phoneDisplay, todayWib } from "@/lib/format";
import { useMounted, useSession } from "@/lib/session";
import { DAY, EMP_STATUS, KIND, REQ, tipe, toneStyle } from "@/lib/status";
import type { StaffDetail } from "@/lib/types";
import { inTimeColor, outTimeColor } from "@/lib/time-tone";

export const Route = createFileRoute("/_app/staff/$id")({ component: KaryawanDetail });

const REQ_PER_PAGE = 5;

function KaryawanDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const s = useSession();
  const today = useMounted(() => todayWib());
  const [tab, setTab] = useState<"ring" | "hadir" | "req" | "dok">("ring");
  const [month, setMonth] = useState<string | null>(null);
  const [reqPage, setReqPage] = useState(0);
  const ym = month ?? today?.slice(0, 7) ?? null;
  const q = useQuery({
    queryKey: ["staff-detail", Number(id), ym],
    queryFn: () => api<StaffDetail>(`/api/v1/admin/staff/${id}`, { query: { month: ym ?? undefined } }),
    enabled: !!ym,
    placeholderData: (p) => p,
  });
  const actions = useStaffActions();
  useCrumb(q.data?.user.name);
  const back = null;
  if (q.isError)
    return (
      <Page>
        {back}
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      </Page>
    );
  const d = q.data;
  if (!d || !ym)
    return (
      <Page>
        {back}
        <Skel className="h-28 rounded-xl" />
        <Skel className="h-72 rounded-xl" />
      </Page>
    );
  const u = d.user;
  const T = tipe(u.employment_type);
  const S = EMP_STATUS[d.status];
  const face = !!u.face_enrolled_at;
  const shiftMonth = (n: number) => {
    const [y, m] = ym.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const stats = [
    { l: "Hadir", n: d.summary.present, c: "#14995A" },
    { l: "Terlambat", n: d.summary.late, c: "#D98A00" },
    { l: "Izin", n: d.summary.izin, c: "#4F5BD5" },
    { l: "Sakit", n: d.summary.sakit, c: "#C82829" },
  ];
  const reqs = [
    ...d.leaves.map((l) => ({
      id: `l${l.id}`,
      kind: l.kind,
      title: `${KIND[l.kind].label} · ${fmtDate(l.start_date)}${l.end_date !== l.start_date ? ` – ${fmtDate(l.end_date)}` : ""}`,
      sub: `${daysBetween(l.start_date, l.end_date)} hari · ${l.reason}`,
      st: l.status,
      href: `/requests/${l.id}`,
      at: l.created_at,
    })),
    ...d.swaps.map((w) => ({
      id: `s${w.id}`,
      kind: "swap",
      title: `Tukar shift · ${fmtDayShort(w.date)}`,
      sub: `${w.from_shift?.name ?? "Libur"} → ${w.to_shift.name} · ${w.reason}`,
      st: w.status,
      href: `/requests/swap/${w.id}`,
      at: w.created_at,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {back}
        {s.can.manageStaff && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => actions.open(u, "edit")}>
              <PencilLine size={16} /> Ubah data
            </Button>
            <Button variant="outline" onClick={() => actions.open(u, "password")}>
              <KeyRound size={16} /> Reset sandi
            </Button>
            {face && (
              <Button variant="outline" onClick={() => actions.open(u, "face")}>
                <ScanFace size={16} /> Reset wajah
              </Button>
            )}
            {u.is_active !== false && (
              <Button variant="dangerOutline" onClick={() => actions.open(u, "toggle")}>
                <Power size={16} /> Nonaktifkan
              </Button>
            )}
          </div>
        )}
      </div>
      <Card className="px-[22px] py-5">
        <div className={cx("flex flex-wrap items-center gap-4", d.status !== "aktif" && "opacity-75")}>
          <span className="flex size-16 flex-none items-center justify-center rounded-xl text-[21px] font-semibold" style={toneStyle(T.bg, T.fg)}>
            {initials(u.name)}
          </span>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <span className="text-xl font-semibold">{u.name}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12.5px] font-medium text-muted">NIK {u.employee_code}</span>
              <span className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-1 text-xs font-medium" style={toneStyle(T.bg, T.fg)}>
                {u.employment_type === "magang" ? <GraduationCap size={13} /> : <BriefcaseBusiness size={13} />}
                {T.label}
              </span>
              {u.unit && <span className="rounded-full bg-soft px-2.5 py-1 text-xs font-medium text-muted">{u.unit}</span>}
              <Pill tone={S} />
            </div>
          </div>
        </div>
      </Card>
      {!face && d.status === "aktif" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warn-bg px-4 py-3.5 text-warn">
          <CircleAlert size={20} />
          <span className="min-w-[200px] flex-1 text-sm font-medium">Wajah belum terdaftar</span>
        </div>
      )}
      {d.status !== "aktif" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-soft px-4 py-3.5 text-muted">
          <CircleAlert size={20} />
          <span className="min-w-[200px] flex-1 text-sm font-medium">Akun {S.label.toLowerCase()}</span>
          {s.can.manageStaff && u.is_active === false && (
            <Button size="sm" onClick={() => actions.open(u, "toggle")}>
              Aktifkan kembali
            </Button>
          )}
        </div>
      )}
      {/* riwayat kehadiran & pengajuan */}
      {s.can.monitor && (
        <div className="flex gap-6 border-b border-line">
          {(
            [
              ["ring", "Ringkasan"],
              ["hadir", "Kehadiran"],
              ["req", "Pengajuan"],
              ["dok", "Dokumen"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cx("h-11 px-0.5 text-sm font-medium", tab === k ? "text-ink shadow-[inset_0_-2.5px_0_#007A87]" : "text-muted")}>
              {l}
            </button>
          ))}
        </div>
      )}

      {tab === "ring" && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Card className="px-[22px] py-5">
              <span className="mb-3.5 block text-base font-semibold">Informasi pribadi</span>
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="Nama">{u.name}</Field>
                <Field label="NIK">{u.employee_code}</Field>
                <Field label="Email">{u.email ?? "—"}</Field>
                <Field label="Nomor HP">{phoneDisplay(u.phone)}</Field>
              </div>
            </Card>
            <Card className="px-[22px] py-5">
              <span className="mb-3.5 block text-base font-semibold">Informasi kerja</span>
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="Tipe">{T.label}</Field>
                <Field label="Unit">{u.unit ?? "—"}</Field>
                <Field label={u.employment_type === "magang" ? "Institusi" : "Vendor"}>{u.institution ?? "—"}</Field>
                <Field label="Mulai dinas">{u.period_start ? fmtDate(u.period_start) : "—"}</Field>
                <Field label="Status">{S.label}</Field>
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-5">
            {s.can.monitor && (
              <Card className="px-[22px] py-5">
                <span className="mb-3.5 block text-base font-semibold">Ringkasan {fmtMonth(ym)}</span>
                <div className="grid grid-cols-2 rounded-xl bg-soft sm:grid-cols-4">
                  {stats.map((x, i) => (
                    <div
                      key={x.l}
                      className={cx("flex flex-col gap-[3px] p-3.5", i % 2 && "border-l border-line", i === 2 && "sm:border-l", i > 1 && "border-t border-line sm:border-t-0")}
                    >
                      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
                        <span className="size-[7px] rounded-full" style={{ background: x.c }} />
                        {x.l}
                      </span>
                      <span className="tnum text-2xl font-semibold">{x.n}</span>
                    </div>
                  ))}
                </div>
                <span className="mt-3 block text-xs font-medium text-faint">
                  Alpa {d.summary.absent} hari · ketepatan waktu {d.summary.punctuality_pct == null ? "–" : `${d.summary.punctuality_pct}%`}
                </span>
              </Card>
            )}
            <Card className="px-[22px] py-5">
              <span className="mb-3.5 block text-base font-semibold">Verifikasi</span>
              {face ? (
                <div className="flex items-center gap-3 rounded-lg bg-ok-bg p-3 text-ok">
                  <ShieldCheck size={20} />
                  <span className="text-[13.5px] font-medium">
                    Wajah terdaftar sejak {fmtDate(u.face_enrolled_at!.slice(0, 10))}
                    {d.last_score != null && ` · skor terakhir ${(d.last_score * 100).toFixed(1).replace(".", ",")}%`}
                  </span>
                </div>
              ) : (
                <div className="rounded-lg bg-warn-bg p-3 text-[13.5px] font-medium text-warn">Wajah belum terdaftar</div>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "hadir" && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Card className="px-[22px] py-5">
            <div className="mb-3.5 flex items-center justify-between">
              <span className="text-base font-semibold">{fmtMonth(ym)}</span>
              <div className="flex gap-1">
                <button aria-label="Bulan sebelumnya" onClick={() => setMonth(shiftMonth(-1))} className="flex size-8 items-center justify-center rounded-full bg-soft">
                  <ChevronLeft size={16} />
                </button>
                <button
                  aria-label="Bulan berikutnya"
                  disabled={!!today && ym >= today.slice(0, 7)}
                  onClick={() => setMonth(shiftMonth(1))}
                  className="flex size-8 items-center justify-center rounded-full bg-soft disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <MonthCalendar ym={ym} days={d.days} today={today ?? ""} />
            <div className="mt-3.5 flex flex-wrap gap-3.5 text-xs font-medium text-muted">
              {[
                ["Hadir", "#14995A"],
                ["Terlambat", "#D98A00"],
                ["Izin", "#4F5BD5"],
                ["Sakit", "#C82829"],
                ["Alpa", "#C82829"],
                ["Libur", "var(--color-off)"],
              ].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
          </Card>
          <Card className="px-[22px] py-5">
            <span className="mb-3.5 block text-base font-semibold">Kehadiran terakhir</span>
            {d.days.length === 0 && <Empty compact />}
            {d.days.slice(0, 12).map((x) => {
              const st = DAY[x.status];
              return (
                <div key={x.date} className="flex items-center gap-3 border-b border-line2 py-3">
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-medium">{fmtDayShort(x.date)}</span>
                    <span className="text-xs font-medium text-faint">
                      {x.shift ? `Shift ${x.shift.name}` : "Tanpa jadwal"}
                      {x.manual ? " · koreksi manual" : ""}
                    </span>
                  </span>
                  <span className="tnum text-[13px] font-medium text-muted">
                    {x.check_in ? (
                      <>
                        <span style={{ color: inTimeColor(x.in_diff_min) }}>{x.check_in}</span> – <span style={{ color: outTimeColor(x.out_diff_min) }}>{x.check_out ?? "…"}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                  <Pill tone={st} className="w-[104px] justify-center">
                    {x.status === "telat" ? `+${x.late_minutes} mnt` : st.label}
                  </Pill>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {tab === "req" && (
        <Card>
          {reqs.length === 0 ? (
            <Empty compact />
          ) : (
            reqs.slice(reqPage * REQ_PER_PAGE, (reqPage + 1) * REQ_PER_PAGE).map((r) => {
              const K = r.kind === "swap" ? { bg: "#FFF3D9", fg: "#8A5600" } : KIND[r.kind];
              const st = REQ[r.st as keyof typeof REQ];
              return (
                <button
                  key={r.id}
                  onClick={() => router.push(r.href)}
                  className="flex w-full items-center gap-3 border-b border-line2 px-5 py-3 text-left last:border-0 hover:bg-hover"
                >
                  <span className="flex size-9 flex-none items-center justify-center rounded-[11px]" style={toneStyle(K.bg, K.fg)}>
                    {r.kind === "sakit" ? <Stethoscope size={17} /> : <FileText size={17} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">{r.title}</span>
                    <span className="truncate text-[12.5px] font-medium text-muted">{r.sub}</span>
                  </span>
                  <Pill tone={st} />
                </button>
              );
            })
          )}
          <Pager page={Math.min(reqPage, Math.max(0, Math.ceil(reqs.length / REQ_PER_PAGE) - 1))} total={reqs.length} perPage={REQ_PER_PAGE} onPage={setReqPage} />
        </Card>
      )}
      {tab === "dok" && <StaffFiles userId={u.id} manage={s.can.manageFiles} />}
      {actions.modal}
    </Page>
  );
}

function MonthCalendar({ ym, days, today }: { ym: string; days: StaffDetail["days"]; today: string }) {
  const [y, m] = ym.split("-").map(Number);
  const first = parseDate(`${ym}-01`);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Senin = kolom pertama
  const by = new Map(days.map((d) => [d.date, d]));
  const color: Record<string, [string, string]> = {
    hadir: ["#E3F5EA", "#14995A"],
    selesai: ["#E3F5EA", "#14995A"],
    tanpa_pulang: ["#FDEEE3", "#B4531A"],
    telat: ["#FFF3D9", "#8A5600"],
    izin: ["#ECEEFC", "#4F5BD5"],
    sakit: ["#FDECEC", "#C82829"],
    alpa: ["#FDECEC", "#C82829"],
    gagal: ["#FDECEC", "#C82829"],
    belum: ["#F4F6F8", "#5B6678"],
  };
  return (
    <div className="grid grid-cols-7 gap-1.5 text-center">
      {[1, 2, 3, 4, 5, 6, 0].map((i) => (
        <span key={i} className="pb-1 text-[11.5px] font-medium text-faint">
          {DAY3[i]}
        </span>
      ))}
      {[...Array(lead)].map((_, i) => (
        <span key={`e${i}`} />
      ))}
      {[...Array(nDays)].map((_, i) => {
        const iso = `${ym}-${String(i + 1).padStart(2, "0")}`;
        const rec = by.get(iso);
        const c = rec ? color[rec.status] : null;
        const isToday = iso === today;
        return (
          <span
            key={iso}
            title={rec ? DAY[rec.status].label : iso > today ? "" : "Libur"}
            className="tnum flex h-10 items-center justify-center rounded-xl text-[13.5px]"
            style={{
              ...(c ? toneStyle(c[0], c[1]) : { color: iso > today ? "var(--color-off)" : "var(--color-faint)" }),
              fontWeight: isToday ? 800 : 600,
              boxShadow: isToday ? "inset 0 0 0 2px var(--color-brand)" : undefined,
            }}
          >
            {i + 1}
          </span>
        );
      })}
    </div>
  );
}
