import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { errMsg } from "@/lib/api";
import { Button, Modal, ModalHead, cx } from "./ui";

/**
 * Impor massal dari Excel: 1) unduh template, 2) pilih file, 3) hasil (jumlah + kesalahan per baris).
 * Dipakai di Karyawan dan Jadwal.
 */
export function ImportModal<R>({
  title,
  sub,
  template,
  extra,
  upload,
  renderResult,
  onClose,
}: {
  title: string;
  sub?: string;
  template: { label: string; download: () => Promise<void> };
  /** isi tambahan di atas langkah (mis. pilihan bulan) */
  extra?: ReactNode;
  upload: (file: File) => Promise<R>;
  renderResult: (r: R) => ReactNode;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"template" | "upload" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<R | null>(null);

  async function getTemplate() {
    setBusy("template");
    setErr(null);
    try {
      await template.download();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function send() {
    if (!file) return;
    setBusy("upload");
    setErr(null);
    try {
      setResult(await upload(file));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} width={520} top={70}>
      <ModalHead title={title} sub={sub} onClose={onClose} />
      {result ? (
        <>
          {renderResult(result)}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => (setResult(null), setFile(null))}>
              Impor lagi
            </Button>
            <Button onClick={onClose}>Selesai</Button>
          </div>
        </>
      ) : (
        <>
          {extra}
          <div className="flex items-center gap-3 rounded-lg border border-line p-3">
            <span className="flex size-7 flex-none items-center justify-center rounded-full bg-soft text-[12.5px] font-semibold text-muted">1</span>
            <span className="min-w-0 flex-1 text-[13.5px] font-medium">{template.label}</span>
            <Button variant="outline" size="sm" loading={busy === "template"} onClick={getTemplate}>
              <Download size={14} /> Unduh
            </Button>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line p-3">
            <span className="flex size-7 flex-none items-center justify-center rounded-full bg-soft text-[12.5px] font-semibold text-muted">2</span>
            {file ? (
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px]">
                <FileSpreadsheet size={16} className="flex-none text-ok" />
                <span className="truncate font-medium">{file.name}</span>
                <button aria-label="Hapus file" onClick={() => setFile(null)} className="flex size-6 flex-none items-center justify-center rounded text-muted hover:text-ink">
                  <X size={14} />
                </button>
              </span>
            ) : (
              <span className="min-w-0 flex-1 text-[13.5px] font-medium">Pilih file yang sudah diisi</span>
            )}
            <input
              ref={input}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              <Upload size={14} /> {file ? "Ganti" : "Pilih file"}
            </Button>
          </div>
          {err && <span className="text-[13px] text-bad">{err}</span>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button data-submit disabled={!file} loading={busy === "upload"} onClick={send}>
              Impor
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Ringkasan hasil impor: angka + daftar kesalahan per baris. */
export function ImportSummary({
  stats,
  errors,
  blocking = true,
  children,
}: {
  stats: { label: string; value: number; tone?: "ok" | "warn" }[];
  errors: string[];
  /** true = ada kesalahan berarti tidak ada yang disimpan (karyawan); false = baris lain tetap disimpan (jadwal) */
  blocking?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-0.5 rounded-lg bg-soft px-3 py-2.5">
            <span className="text-xs text-muted">{s.label}</span>
            <span className={cx("tnum text-lg font-semibold", s.tone === "ok" && s.value > 0 && "text-ok", s.tone === "warn" && s.value > 0 && "text-warn")}>{s.value}</span>
          </div>
        ))}
      </div>
      {errors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-bad">{blocking ? `${errors.length} baris perlu diperbaiki · tidak ada yang disimpan` : `${errors.length} isian dilewati`}</span>
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] leading-relaxed">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </div>
  );
}
