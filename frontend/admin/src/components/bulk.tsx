import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { BulkActionResult } from "@/lib/types";
import { Button, Modal, ModalHead } from "./ui";

/** Baris aksi massal yang menggantikan kolom cari saat ada baris terpilih. */
export function BulkBar({ count, noun, onClear, children }: { count: number; noun: string; onClear: () => void; children: ReactNode }) {
  return (
    <>
      <span className="tnum text-[13px] font-medium">
        {count} {noun} dipilih
      </span>
      {children}
      <button onClick={onClear} className="h-8 px-2 text-[13px] text-muted hover:text-ink">
        Batal
      </button>
    </>
  );
}

/** Ringkasan aksi massal yang sebagian gagal: daftar baris + alasannya. */
export function BulkResultModal({ title, result, onClose }: { title: string; result: BulkActionResult; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} width={480}>
      <ModalHead title={title} sub={`${result.done} berhasil · ${result.failed.length} gagal`} onClose={onClose} />
      <div className="flex items-start gap-3 rounded-lg bg-warn-bg px-3.5 py-3 text-warn">
        <TriangleAlert size={18} className="mt-0.5 flex-none" />
        <span className="text-[13px]">Baris berikut tidak diproses:</span>
      </div>
      <div className="flex max-h-[320px] flex-col overflow-y-auto rounded-lg border border-line">
        {result.failed.map((f) => (
          <div key={`${f.label}-${f.id}`} className="flex flex-col gap-0.5 border-b border-line2 px-3 py-2 last:border-0">
            <span className="text-[13px] font-medium">{f.label}</span>
            <span className="text-xs text-muted">{f.error}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>Selesai</Button>
      </div>
    </Modal>
  );
}
