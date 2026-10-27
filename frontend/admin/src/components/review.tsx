import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { api, apiUrl, errMsg } from "@/lib/api";
import { daysBetween, firstName, fmtRange } from "@/lib/format";
import type { BulkActionResult, LeaveOut, SwapOut } from "@/lib/types";
import { useToast } from "./providers";
import { Button, FormRow, IconBtn, Modal, ModalHead, cx, textareaCls } from "./ui";

export type ReviewKind = "approve" | "reject" | "doc";

const tLine = (r: LeaveOut) => `${r.kind === "sakit" ? "Sakit" : "Izin"} · ${r.name} · ${fmtRange(r.start_date, r.end_date)}`;

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["leaves"] });
    qc.invalidateQueries({ queryKey: ["leave"] });
    qc.invalidateQueries({ queryKey: ["swaps"] });
    qc.invalidateQueries({ queryKey: ["pending-count"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["daily"] });
    qc.invalidateQueries({ queryKey: ["shifts"] });
  };
}

/** Modal Setujui / Tolak / Dokumen untuk pengajuan Izin & Sakit. */
export function LeaveModals({ req, kind, onClose }: { req: LeaveOut | null; kind: ReviewKind | null; onClose: () => void }) {
  if (!req || !kind) return null;
  if (kind === "doc") return <DocModal req={req} onClose={onClose} />;
  return <DecideModal req={req} approve={kind === "approve"} onClose={onClose} />;
}

function DecideModal({ req, approve, onClose }: { req: LeaveOut; approve: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api<LeaveOut>(`/api/v1/admin/leaves/${req.id}/review`, {
        body: { approve, note: note.trim() || null },
      }),
    onSuccess: () => {
      invalidate();
      toast(`Pengajuan ${approve ? "disetujui" : "ditolak"} · notifikasi terkirim ke ${firstName(req.name ?? "")}`);
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (!approve && note.trim().length < 3) return setErr("Tulis alasan penolakan agar karyawan tahu apa yang perlu diperbaiki.");
    setErr(null);
    m.mutate();
  }
  if (approve) {
    return (
      <Modal open onClose={onClose}>
        <div className="flex justify-between gap-3">
          <span className="flex size-12 items-center justify-center rounded-lg bg-ok-bg text-ok">
            <Check size={24} strokeWidth={2.4} />
          </span>
          <IconBtn label="Tutup" onClick={onClose}>
            <X size={16} strokeWidth={2.2} />
          </IconBtn>
        </div>
        <span className="text-[19px] font-semibold leading-[1.3]">Setujui pengajuan {tLine(req)}?</span>
        {req.kind === "sakit" && !req.has_attachment && (
          <div className="rounded-lg bg-bad-bg px-3.5 py-3 text-[12.5px] font-medium leading-[1.45] text-bad">SKD belum dilampirkan. Pastikan dokumen sudah diterima sebelum menyetujui.</div>
        )}
        <FormRow label="Catatan" error={err}>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Shift digantikan Ns. Dewi" className={textareaCls} />
        </FormRow>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
          <Button variant="outline" size="lg" onClick={onClose}>
            Batal
          </Button>
          <Button size="lg" loading={m.isPending} onClick={submit}>
            Setujui
          </Button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose}>
      <ModalHead title="Tolak pengajuan" sub={tLine(req)} onClose={onClose} />
      <FormRow label="Alasan penolakan" required error={err}>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Alasan ini dikirim ke karyawan" className={cx(textareaCls, err && "shadow-[0_0_0_2px_#F2B8B8]")} />
      </FormRow>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
        <Button variant="outline" size="lg" onClick={onClose}>
          Batal
        </Button>
        <Button variant="danger" size="lg" loading={m.isPending} onClick={submit}>
          Tolak pengajuan
        </Button>
      </div>
    </Modal>
  );
}

function DocModal({ req, onClose }: { req: LeaveOut; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const src = apiUrl(`/api/v1/leaves/${req.id}/attachment`);
  const isPdf = req.attachment_mime === "application/pdf";
  const name = `SKD_${(req.name ?? "").replace(/[^A-Za-z0-9]+/g, "_")}${isPdf ? ".pdf" : ".jpg"}`;
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-[rgba(13,23,38,.6)]" />
      <div className="animate-rise absolute inset-y-10 left-1/2 flex w-[640px] max-w-[calc(100%-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-card shadow-card">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{name}</span>
          {!isPdf && (
            <div className="flex items-center gap-1 rounded-full bg-soft p-[3px]">
              <button aria-label="Perkecil" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} className="flex size-8 items-center justify-center rounded-full bg-card">
                <Minus size={15} />
              </button>
              <span className="tnum w-12 text-center text-[12.5px] font-semibold">{Math.round(zoom * 100)}%</span>
              <button aria-label="Perbesar" onClick={() => setZoom(Math.min(3, zoom + 0.25))} className="flex size-8 items-center justify-center rounded-full bg-card">
                <Plus size={15} />
              </button>
            </div>
          )}
          <a href={src} target="_blank" rel="noreferrer" className="hidden h-9 items-center rounded-lg bg-brand-soft px-3.5 text-[13px] font-medium text-brand sm:flex">
            Buka tab baru
          </a>
          <IconBtn label="Tutup" onClick={onClose}>
            <X size={16} strokeWidth={2.2} />
          </IconBtn>
        </div>
        <div className="flex flex-1 items-start justify-center overflow-auto bg-track p-6">
          {isPdf ? (
            <iframe src={src} title="Dokumen SKD" className="h-full min-h-[60vh] w-full rounded bg-card" />
          ) : (
            <img src={src} alt="Dokumen SKD" className="max-w-none rounded bg-card transition-[width] duration-200" style={{ width: `${zoom * 100}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Modal tolak tukar shift (alasan wajib). */
export function SwapRejectModal({ swap, onClose }: { swap: SwapOut | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api(`/api/v1/admin/swaps/${swap!.id}/review`, {
        body: { approve: false, note: note.trim() },
      }),
    onSuccess: () => {
      invalidate();
      toast("Tukar shift ditolak · alasan dikirim ke karyawan");
      setNote("");
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  if (!swap) return null;
  return (
    <Modal open onClose={onClose} top={120}>
      <div className="flex flex-col gap-[3px]">
        <span className="text-[19px] font-semibold">Tolak tukar shift</span>
        <span className="text-[13px] font-medium text-muted">
          {swap.target_name ? `${swap.name} ↔ ${swap.target_name}` : swap.name} · {swap.summary}
        </span>
      </div>
      <FormRow label="Alasan penolakan" required error={err}>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Alasan ini dikirim ke karyawan" className={cx(textareaCls, err && "shadow-[0_0_0_2px_#F2B8B8]")} />
      </FormRow>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
        <Button variant="outline" size="lg" onClick={onClose}>
          Batal
        </Button>
        <Button variant="danger" size="lg" loading={m.isPending} onClick={() => (note.trim().length < 3 ? setErr("Tulis alasan penolakan.") : (setErr(null), m.mutate()))}>
          Tolak tukar shift
        </Button>
      </div>
    </Modal>
  );
}

export function useApproveSwap() {
  const toast = useToast();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (s: SwapOut) => api(`/api/v1/admin/swaps/${s.id}/review`, { body: { approve: true } }),
    onSuccess: (_d, s) => {
      invalidate();
      toast(`Tukar shift ${firstName(s.name ?? "")} disetujui · jadwal diperbarui`);
    },
    onError: (e) => toast(errMsg(e)),
  });
}

export const leaveDuration = (r: LeaveOut) => `${daysBetween(r.start_date, r.end_date)} hari`;

/** Konfirmasi setujui tukar shift (jadwal karyawan langsung diperbarui). */
export function SwapApproveModal({ swap, onClose }: { swap: SwapOut | null; onClose: () => void }) {
  const approve = useApproveSwap();
  if (!swap) return null;
  return (
    <Modal open onClose={onClose}>
      <ModalHead title="Setujui tukar shift?" sub={swap.target_name ? `${swap.name} ↔ ${swap.target_name} · ${swap.summary}` : `${swap.name} · ${swap.summary}`} onClose={onClose} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button loading={approve.isPending} onClick={() => approve.mutate(swap, { onSuccess: onClose })}>
          Setujui
        </Button>
      </div>
    </Modal>
  );
}

/** Setujui / tolak banyak pengajuan sekaligus (Kepala Unit). Alasan wajib saat menolak; dipakai untuk semua baris. */
export function BulkReviewModal({
  items,
  approve,
  onClose,
  onDone,
}: {
  items: { kind: "leave" | "swap"; id: number }[];
  approve: boolean;
  onClose: () => void;
  onDone: (r: BulkActionResult) => void;
}) {
  const invalidate = useInvalidate();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api<BulkActionResult>("/api/v1/admin/requests/review", {
        body: { items, approve, note: note.trim() || null },
      }),
    onSuccess: (r) => {
      invalidate();
      onDone(r);
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (!approve && note.trim().length < 3) return setErr("Tulis alasan penolakan agar karyawan tahu apa yang perlu diperbaiki.");
    setErr(null);
    m.mutate();
  }
  return (
    <Modal open onClose={onClose}>
      <ModalHead title={`${approve ? "Setujui" : "Tolak"} ${items.length} pengajuan?`} sub="Setiap karyawan menerima notifikasi keputusan." onClose={onClose} />
      <FormRow label={approve ? "Catatan" : "Alasan penolakan"} required={!approve} error={err}>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={approve ? "Opsional, dikirim ke semua karyawan terpilih" : "Alasan ini dikirim ke semua karyawan terpilih"}
          className={cx(textareaCls, err && !approve && "shadow-[0_0_0_2px_#F2B8B8]")}
        />
      </FormRow>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
        <Button variant="outline" size="lg" onClick={onClose}>
          Batal
        </Button>
        <Button variant={approve ? "primary" : "danger"} size="lg" loading={m.isPending} onClick={submit}>
          {approve ? "Setujui semua" : "Tolak semua"}
        </Button>
      </div>
    </Modal>
  );
}
