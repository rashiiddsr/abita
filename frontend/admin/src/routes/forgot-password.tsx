import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Mail } from "lucide-react";
import { Link } from "@/lib/nav";
import { useEffect, useState, type FormEvent } from "react";
import { AuthAlert, AuthButton, AuthField, AuthShell, EMAIL_RE } from "@/components/auth-shell";
import { api, errMsg } from "@/lib/api";

export const Route = createFileRoute("/forgot-password")({ component: LupaSandiPage });

function LupaSandiPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // halaman disimpan tersembunyi saat kembali ke Masuk: kembalikan ke keadaan awal saat ditinggalkan
  useEffect(
    () => () => {
      setEmail("");
      setDone(null);
      setErr(null);
      setBusy(false);
    },
    [],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setErr("Masukkan email yang valid.");
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ message: string }>("/api/v1/auth/forgot", { body: { identifier: email.trim().toLowerCase() } });
      setDone(r.message);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Lupa kata sandi" onSubmit={submit}>
      {done ? (
        <AuthAlert tone="ok" title="Cek email Anda" body={done} />
      ) : (
        <>
          {err && <AuthAlert tone="error" title={err} />}
          <AuthField
            label="Email"
            icon={<Mail size={18} />}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@awalbros.cc"
            autoComplete="email"
            invalid={!!err}
          />
          <AuthButton busy={busy}>Kirim kata sandi baru</AuthButton>
        </>
      )}
      <Link href="/login" className="flex items-center justify-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Kembali ke halaman masuk
      </Link>
    </AuthShell>
  );
}
