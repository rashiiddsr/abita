import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Check, Clock3, X } from "lucide-react";
import { useParams } from "@/lib/nav";
import { useState } from "react";
import { SwapApproveModal, SwapRejectModal } from "@/components/review";
import { Page, useCrumb } from "@/components/shell";
import { Button, Card, ErrorState, Field, Pill, Skel, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateLong, fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { shiftTone, swapTone, tipe, toneStyle } from "@/lib/status";
import type { ShiftType, SwapOut } from "@/lib/types";

export const Route = createFileRoute("/_app/requests/swap/$id")({ component: TukarShiftDetail });

type Step = { title: string; who: string; at?: string | null; note?: string | null; state: "done" | "wait" | "no" | "idle" };

function TukarShiftDetail() {
  const { id } = useParams<{ id: string }>();
  const s = useSession();
  const [modal, setModal] = useState<"approve" | "reject" | null>(null);
  const q = useQuery({ queryKey: ["swaps", "detail", id], queryFn: () => api<SwapOut>(`/api/v1/admin/swaps/${id}`) });
  const w = q.data;
  useCrumb(w?.name);
  const back = null;
  if (q.isError) return <Page>{back}<ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /></Page>;
  if (!w)
    return (
      <Page>
        {back}
        <div className="grid gap-5 lg:grid-cols-[7fr_5fr]">
          <Skel className="h-72 rounded-xl" />
          <Skel className="h-72 rounded-xl" />
        </div>
      </Page>
    );

  const head = s.units.find((u) => u.name === w.unit)?.head_name ?? "—";
  const decided = w.status === "approved" || w.status === "rejected";
  const peerDeclined = w.peer_status === "declined";
  const steps: Step[] = [
    { title: "Diajukan", who: w.name ?? "—", at: w.created_at, note: w.reason, state: "done" },
    // langkah rekan hanya untuk pengajuan lama; pengajuan baru langsung diputuskan Kepala Unit
    ...(w.target_name && w.peer_status
      ? [
          {
            title: w.peer_status === "accepted" ? "Rekan menerima" : peerDeclined ? "Rekan menolak" : "Menunggu rekan",
            who: w.target_name,
            at: w.peer_responded_at,
            note: w.peer_note,
            state: w.peer_status === "accepted" ? "done" : peerDeclined ? "no" : w.status === "cancelled" ? "idle" : "wait",
          } satisfies Step,
        ]
      : []),
    peerDeclined || w.status === "cancelled"
      ? { title: w.status === "cancelled" ? "Dibatalkan pemohon" : "Kepala Unit", who: w.status === "cancelled" ? (w.name ?? "—") : head, state: "idle" }
      : decided
        ? { title: w.status === "approved" ? "Disetujui" : "Ditolak", who: w.reviewer_name ?? head, at: w.reviewed_at, note: w.review_note, state: w.status === "approved" ? "done" : "no" }
        : { title: "Menunggu Kepala Unit", who: head, state: w.stage === "review" ? "wait" : "idle" },
  ];

  return (
    <Page>
      {back}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base font-semibold">Tukar shift</span>
                <span className="text-[13px] text-muted">
                  {w.unit ?? "—"} · {tipe(w.employment_type).label}
                </span>
              </div>
              <Pill tone={swapTone(w)} />
            </div>
            <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <Party role="Pemohon" name={w.name ?? "—"} code={w.employee_code} date={w.date} shift={w.from_shift} gives />
              <span className="flex items-center justify-center text-faint">
                <ArrowLeftRight size={18} />
              </span>
              {w.target_name ? (
                <Party role="Rekan" name={w.target_name} code={w.target_code} date={w.target_date ?? w.date} shift={w.to_shift} />
              ) : (
                <Party role="Shift baru" name={w.to_shift.name} date={w.date} shift={w.to_shift} />
              )}
            </div>
            {w.target_name && (
              <div className="mt-3 rounded-lg bg-soft px-3 py-2.5 text-[13px] text-muted">
                {w.target_date && w.target_date !== w.date
                  ? `${w.target_name} masuk ${w.from_shift?.name ?? "—"} pada ${fmtDateLong(w.date)}; ${w.name} masuk ${w.to_shift.name} pada ${fmtDateLong(w.target_date)}.`
                  : `${fmtDateLong(w.date)}: ${w.name} masuk ${w.to_shift.name}, ${w.target_name} masuk ${w.from_shift?.name ?? "—"}.`}
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3.5 border-t border-line pt-4">
              <Field label="Alasan">{w.reason}</Field>
              <Field label="Diajukan">{fmtDateTime(w.created_at)}</Field>
            </div>
          </Card>
        </div>

        <Card className="flex min-w-0 flex-col gap-4 p-5 lg:sticky lg:top-20">
          <span className="text-[15px] font-semibold">Persetujuan</span>
          <div className="flex flex-col">
            {steps.map((st, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cx(
                      "flex size-6 flex-none items-center justify-center rounded-full",
                      st.state === "done" ? "bg-ok-bg text-ok" : st.state === "no" ? "bg-bad-bg text-bad" : st.state === "wait" ? "bg-warn-bg text-warn" : "bg-soft text-faint",
                    )}
                  >
                    {st.state === "done" ? <Check size={13} strokeWidth={3} /> : st.state === "no" ? <X size={13} strokeWidth={3} /> : <Clock3 size={13} />}
                  </span>
                  {i < steps.length - 1 && <span className="my-1 w-px flex-1 bg-line" />}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 pb-4">
                  <span className={cx("text-sm font-medium", st.state === "idle" && "text-muted")}>{st.title}</span>
                  <span className="text-[13px] text-muted">{st.who}</span>
                  {st.at && <span className="tnum text-xs text-faint">{fmtDateTime(st.at)}</span>}
                  {st.note && i > 0 && <span className="mt-1 rounded-lg bg-soft px-3 py-2 text-[13px]">{st.note}</span>}
                </div>
              </div>
            ))}
          </div>
          {w.can_review && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="dangerOutline" size="lg" onClick={() => setModal("reject")}>
                Tolak
              </Button>
              <Button size="lg" onClick={() => setModal("approve")}>
                <Check size={16} /> Setujui
              </Button>
            </div>
          )}
        </Card>
      </div>
      <SwapApproveModal swap={modal === "approve" ? w : null} onClose={() => setModal(null)} />
      <SwapRejectModal swap={modal === "reject" ? w : null} onClose={() => setModal(null)} />
    </Page>
  );
}

function Party({ role, name, code, date, shift, gives }: { role: string; name: string; code?: string | null; date: string; shift: ShiftType | null; gives?: boolean }) {
  const t = shift ? shiftTone(shift.name, shift.color) : null;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-line p-3">
      <span className="text-xs text-muted">{role}</span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        {code && <span className="tnum text-xs text-muted">{code}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="tnum flex h-7 items-center rounded-md px-2 text-xs font-semibold" style={t ? toneStyle(t.bg, t.fg) : undefined}>
          {shift ? `${shift.name} ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}` : "Libur"}
        </span>
      </div>
      <span className="text-[12.5px] text-muted">
        {gives ? "Menyerahkan" : "Shift"} · {fmtDateLong(date)}
      </span>
    </div>
  );
}
