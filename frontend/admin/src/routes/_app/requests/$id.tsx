import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, Clock3, FileText, Send, Stethoscope, X } from "lucide-react";
import { useParams } from "@/lib/nav";
import { useState } from "react";
import { LeaveModals, leaveDuration, type ReviewKind } from "@/components/review";
import { Page, useCrumb } from "@/components/shell";
import { Button, Card, ErrorState, Field, Pill, Skel } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateLong, fmtDateTime, fmtRange, initials } from "@/lib/format";
import { useSession } from "@/lib/session";
import { KIND, REQ, tipe, toneStyle } from "@/lib/status";
import type { LeaveOut, MonthSummary } from "@/lib/types";
import { flagOf } from "@/lib/leave";

export const Route = createFileRoute("/_app/requests/$id")({ component: PengajuanDetail });

function PengajuanDetail() {
  const { id } = useParams<{ id: string }>();
  const s = useSession();
  const [modal, setModal] = useState<ReviewKind | null>(null);
  const q = useQuery({ queryKey: ["leave", id], queryFn: () => api<LeaveOut>(`/api/v1/admin/leaves/${id}`) });
  const r = q.data;
  const sum = useQuery({
    queryKey: ["summary", r?.user_id],
    queryFn: () => api<MonthSummary>(`/api/v1/admin/users/${r!.user_id}/summary`),
    enabled: !!r,
  });

  useCrumb(r?.name);
  const back = null;
  if (q.isError) return <Page>{back}<ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /></Page>;
  if (!r)
    return (
      <Page>
        {back}
        <div className="grid gap-5 lg:grid-cols-[7fr_5fr]">
          <Skel className="h-80 rounded-xl" />
          <Skel className="h-80 rounded-xl" />
        </div>
      </Page>
    );

  const S = REQ[r.status];
  const K = KIND[r.kind];
  const T = tipe(r.employment_type);
  const flag = flagOf(r);
  const head = s.units.find((u) => u.name === r.unit)?.head_name ?? null;

  type Step = { title: string; who: string; when?: string; note?: string; noteBg?: string; noteC?: string; tone: "done" | "wait" | "bad" | "idle" };
  const steps: Step[] = [{ title: "Diajukan", who: `${r.name} lewat aplikasi ABiTA`, when: fmtDateTime(r.created_at), tone: "done" }];
  if (r.status === "pending") {
    steps.push({ title: "Menunggu Kepala Unit", who: head ?? "—", tone: "wait" });
  } else {
    const ok = r.status === "approved";
    steps.push({
      title: ok ? "Disetujui" : "Ditolak",
      who: r.reviewer_name ?? "—",
      when: r.reviewed_at ? fmtDateTime(r.reviewed_at) : undefined,
      note: r.review_note ?? undefined,
      noteBg: ok ? "#E3F5EA" : "#FDECEC",
      noteC: ok ? "#14995A" : "#C82829",
      tone: ok ? "done" : "bad",
    });
  }
  const dot = { done: ["#E3F5EA", "#14995A"], wait: ["#FFF3D9", "#8A5600"], bad: ["#FDECEC", "#C82829"], idle: ["#F4F6F8", "#97A1B0"] } as const;
  const stats = sum.data
    ? [
        { n: sum.data.present, l: "Hadir", bg: "#E3F5EA", c: "#14995A" },
        { n: sum.data.late, l: "Terlambat", bg: "#FFF3D9", c: "#8A5600" },
        { n: sum.data.izin, l: "Izin", bg: "#ECEEFC", c: "#4F5BD5" },
        { n: sum.data.sakit, l: "Sakit", bg: "#FDECEC", c: "#C82829" },
      ]
    : [];

  return (
    <Page>
      {back}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="px-[22px] py-5">
            <div className="flex items-center gap-3.5">
              <span className="flex size-[52px] flex-none items-center justify-center rounded-lg bg-brand-soft text-base font-semibold text-brand">{initials(r.name ?? "")}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-lg font-semibold">{r.name}</span>
                <span className="text-[12.5px] font-medium text-muted">NIK {r.employee_code}</span>
              </div>
              <Pill tone={S} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3.5 border-t border-line pt-4">
              <Field label="Tipe">{T.label}</Field>
              <Field label="Unit">{r.unit ?? "—"}</Field>
              {r.institution && <Field label={r.employment_type === "magang" ? "Institusi" : "Vendor"}>{r.institution}</Field>}
              {r.phone && <Field label="Nomor HP">{r.phone}</Field>}
            </div>
          </Card>
          <Card className="px-[22px] py-5">
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-[11px]" style={toneStyle(K.bg, K.fg)}>
                {r.kind === "sakit" ? <Stethoscope size={18} /> : <FileText size={18} />}
              </span>
              <span className="text-base font-semibold">Pengajuan {K.label}</span>
              {flag && (
                <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-medium" style={toneStyle(flag.bg, flag.c)}>
                  {flag.text}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <Field label="Tanggal mulai">{fmtDateLong(r.start_date)}</Field>
              <Field label="Tanggal selesai">{fmtDateLong(r.end_date)}</Field>
              <Field label="Durasi">{leaveDuration(r)}</Field>
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-faint">Alasan</span>
              <span className="text-[14.5px] font-normal leading-[1.55]">{r.reason}</span>
            </div>
            <div className="tnum mt-4 border-t border-line pt-3.5 text-[13px] font-medium text-muted">Diajukan {fmtDateTime(r.created_at)} lewat aplikasi ABiTA</div>
          </Card>
          {r.kind === "sakit" && (
            <Card className="px-[22px] py-5">
              <span className="mb-3.5 block text-base font-semibold">Dokumen pendukung</span>
              {r.has_attachment ? (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setModal("doc")}
                    aria-label="Buka dokumen"
                    className="h-[124px] w-24 flex-none cursor-zoom-in rounded-xl bg-soft p-2.5"
                  >
                    <span className="flex size-full flex-col gap-[5px] rounded bg-card px-[7px] py-2 shadow-[0_0_0_1px_var(--color-line)]">
                      <span className="h-[5px] w-3/5 rounded-sm bg-brand" />
                      <span className="mt-1 h-[3px] w-4/5 rounded-sm bg-off" />
                      <span className="h-[3px] w-[90%] rounded-sm bg-line" />
                      <span className="h-[3px] w-[70%] rounded-sm bg-line" />
                      <span className="h-[3px] w-[85%] rounded-sm bg-line" />
                      <span className="mt-auto h-2.5 w-[34%] self-end rounded-sm bg-brand-soft" />
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="truncate text-sm font-medium">SKD_{(r.name ?? "").replace(/[^A-Za-z0-9]+/g, "_")}</span>
                    <span className="text-[12.5px] font-normal text-muted">Surat keterangan dokter · {r.attachment_mime === "application/pdf" ? "PDF" : "Foto"}</span>
                    <Button variant="soft" className="mt-1.5 self-start" onClick={() => setModal("doc")}>
                      <FileText size={16} /> Buka dokumen
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2.5 rounded-lg bg-bad-bg p-3.5 text-bad">
                  <CircleAlert size={20} className="flex-none" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Dokumen SKD belum dilampirkan</span>
                    <span className="text-[12.5px] font-normal leading-[1.45] text-muted">Pengajuan Sakit perlu surat keterangan dokter sebelum disetujui.</span>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4">
          <Card className="px-[22px] py-5">
            <span className="mb-3.5 block text-base font-semibold">Status persetujuan</span>
            {steps.map((e, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex w-[26px] flex-none flex-col items-center">
                  <span className="flex size-[26px] flex-none items-center justify-center rounded-full" style={toneStyle(dot[e.tone][0], dot[e.tone][1])}>
                    {e.tone === "done" ? <Check size={14} strokeWidth={3} /> : e.tone === "bad" ? <X size={14} strokeWidth={3} /> : e.tone === "wait" ? <Clock3 size={14} strokeWidth={2.6} /> : <Send size={12} />}
                  </span>
                  <span className="min-h-3.5 w-0.5 flex-1 bg-line" style={{ opacity: i < steps.length - 1 ? 1 : 0 }} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px] pb-4 pt-[3px]">
                  <span className="text-sm font-medium" style={{ color: e.tone === "idle" ? "#97A1B0" : "#0D1726" }}>
                    {e.title}
                  </span>
                  <span className="text-[12.5px] font-medium text-muted">{e.who}</span>
                  {e.when && <span className="tnum text-xs font-medium text-faint">{e.when}</span>}
                  {e.note && (
                    <span className="mt-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-medium leading-[1.45]" style={toneStyle(e.noteBg ?? "", e.noteC ?? "")}>
                      {e.note}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {r.can_review && (
              <div className="mt-1 grid grid-cols-[1fr_1.4fr] gap-2.5">
                <Button variant="dangerOutline" className="h-[54px] text-[15.5px]" onClick={() => setModal("reject")}>
                  Tolak
                </Button>
                <Button className="h-[54px] text-[15.5px]" onClick={() => setModal("approve")}>
                  <Check size={18} strokeWidth={2.6} /> Setujui
                </Button>
              </div>
            )}
          </Card>
          <Card className="px-[22px] py-5">
            <span className="mb-3.5 block text-base font-semibold">Kehadiran bulan ini</span>
            <div className="grid grid-cols-4 gap-2">
              {stats.length === 0 && [...Array(4)].map((_, i) => <Skel key={i} className="h-[66px] rounded-lg" />)}
              {stats.map((x) => (
                <div key={x.l} className="flex flex-col gap-0.5 rounded-lg p-3" style={toneStyle(x.bg, x.c)}>
                  <span className="tnum text-xl font-semibold">
                    {x.n}
                  </span>
                  <span className="text-xs font-medium">
                    {x.l}
                  </span>
                </div>
              ))}
            </div>
            <span className="mt-3 block text-xs font-medium text-faint">Periode pengajuan: {fmtRange(r.start_date, r.end_date)}</span>
          </Card>
        </div>
      </div>
      <LeaveModals req={modal ? r : null} kind={modal} onClose={() => setModal(null)} />
    </Page>
  );
}
