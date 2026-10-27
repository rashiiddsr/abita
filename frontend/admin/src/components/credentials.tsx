import { useMutation } from "@tanstack/react-query";
import { Check, Copy, MailCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import type { CredentialResult, User } from "@/lib/types";
import { useToast } from "./providers";
import { Button, Modal, ModalHead, cx } from "./ui";

/** Hasil buat akun / reset kata sandi (satu akun): kata sandi selalu ditampilkan sekali, plus status pengiriman email. */
export function CredentialNotice({ name, email, result, onClose }: { name: string; email: string | null; result: CredentialResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open onClose={onClose} width={440}>
      <ModalHead title="Kata sandi akun" sub={name} onClose={onClose} />
      {result.email_sent ? (
        <div className="flex items-start gap-3 rounded-lg bg-ok-bg px-3.5 py-3 text-ok">
          <MailCheck size={18} className="mt-0.5 flex-none" />
          <span className="text-[13px]">Juga dikirim ke {email}.</span>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg bg-warn-bg px-3.5 py-3 text-warn">
          <TriangleAlert size={18} className="mt-0.5 flex-none" />
          <span className="text-[13px]">Email tidak terkirim: {result.email_error}</span>
        </div>
      )}
      {result.temp_password && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Kata sandi</span>
          <div className="flex items-center gap-2">
            <code className="tnum flex h-10 flex-1 items-center rounded-lg border border-line bg-soft px-3 text-[15px] font-medium tracking-wider">{result.temp_password}</code>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(result.temp_password ?? "");
                setCopied(true);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Tersalin" : "Salin"}
            </Button>
          </div>
          <span className="text-xs text-muted">Hanya ditampilkan sekali. Pemilik akun wajib menggantinya saat pertama masuk.</span>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>Selesai</Button>
      </div>
    </Modal>
  );
}

/** Konfirmasi reset kata sandi: sistem membuat kata sandi baru dan mengirimnya ke email pengguna. */
export function ResetPasswordFlow({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast();
  const [result, setResult] = useState<CredentialResult | null>(null);
  const m = useMutation({
    mutationFn: () => api<CredentialResult>(`/api/v1/admin/users/${user.id}/reset-password`, { method: "POST" }),
    onSuccess: setResult,
    onError: (e) => toast(errMsg(e)),
  });
  if (result) return <CredentialNotice name={user.name} email={user.email} result={result} onClose={onClose} />;
  return (
    <Modal open onClose={onClose}>
      <ModalHead title="Reset kata sandi?" sub={user.name} onClose={onClose} />
      <span className="text-[13px] text-muted">{user.email ? `Kata sandi baru dibuat sistem dan dikirim ke ${user.email}.` : "Akun ini belum punya email."}</span>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button loading={m.isPending} onClick={() => m.mutate()}>
          Reset & kirim
        </Button>
      </div>
    </Modal>
  );
}

/** Daftar kata sandi baru untuk akun yang emailnya gagal terkirim (impor / reset massal). Tampil sekali. */
export function CredentialList({ rows }: { rows: { name: string; email: string; temp_password: string | null; error: string | null }[] }) {
  const [copied, setCopied] = useState(false);
  if (!rows.length) return null;
  const text = rows.map((r) => `${r.name}\t${r.email}\t${r.temp_password ?? ""}`).join("\n");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3 rounded-lg bg-warn-bg px-3.5 py-3 text-warn">
        <TriangleAlert size={18} className="mt-0.5 flex-none" />
        <span className="text-[13px]">
          Email gagal terkirim ke {rows.length} akun. Bagikan kata sandi baru ini secara langsung; hanya tampil sekali.
          {rows[0].error && <span className="mt-1 block text-[12.5px] opacity-80">{rows[0].error}</span>}
        </span>
      </div>
      <div className="max-h-52 overflow-y-auto rounded-lg border border-line">
        {rows.map((r, i) => (
          <div key={i} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2", i > 0 && "border-t border-line2")}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">{r.name}</span>
              <span className="truncate text-xs text-muted">{r.email}</span>
            </span>
            <code className="tnum rounded-md bg-soft px-2 py-1 text-[13px] font-medium tracking-wider">{r.temp_password}</code>
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "Tersalin" : "Salin semua"}
      </Button>
    </div>
  );
}
