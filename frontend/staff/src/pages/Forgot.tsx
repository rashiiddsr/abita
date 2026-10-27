/**
 * Lupa kata sandi (karyawan): masukkan email -> kata sandi baru dikirim ke email (antrean + cron di server).
 * Masuk dengan kata sandi itu, lalu aplikasi meminta kata sandi buatan sendiri.
 */
import { CircleAlert, MailCheck, Mail } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "../lib/nav";
import { useHelpdesk } from "../components/helpdesk";
import { SubPage } from "../components/shell";
import { Card, cx, Field, IconTile, inputCls, PrimaryButton, SecondaryButton } from "../components/ui";
import { api, errMsg } from "../lib/api";

const RESEND_S = 120; // sama dengan jeda antarpermintaan di API
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ForgotPage() {
  const nav = useNavigate();
  const help = useHelpdesk("Halo Admin SDM, saya lupa kata sandi aplikasi ABiTA. NIK saya: ");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0); // detik sampai boleh meminta lagi
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError("Masukkan email yang valid.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/auth/app-forgot", { body: { identifier: email.trim() } });
      setSent(r.message);
      setLeft(RESEND_S);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SubPage title="Lupa kata sandi" back="/login">
      <Card className="mt-2">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <IconTile icon={<MailCheck size={26} />} tone="ok" size={56} />
            <span className="font-display text-[18px] font-bold">Cek email Anda</span>
            <p className="text-[14px] leading-relaxed text-muted">{sent}</p>
            <span className="text-[13px] font-semibold text-ink">{email.trim()}</span>
            {error && <ErrorBox msg={error} />}
            <PrimaryButton className="mt-2" onClick={() => nav("/login", { replace: true })}>
              Masuk
            </PrimaryButton>
            <SecondaryButton disabled={busy || left > 0} onClick={() => send()}>
              {left > 0 ? `Kirim ulang dalam ${left}d` : "Kirim ulang"}
            </SecondaryButton>
          </div>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-4" noValidate>
            <Field label="Email">
              <span className="relative">
                <Mail size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="nama@email.com" className={cx(inputCls, "pl-11")} />
              </span>
            </Field>
            {error && <ErrorBox msg={error} />}
            <PrimaryButton type="submit" loading={busy}>
              {busy ? "Memproses…" : "Kirim kata sandi baru"}
            </PrimaryButton>
          </form>
        )}
      </Card>
      <button type="button" onClick={help.openHelp} className="mx-auto mt-5 block text-[14px] text-muted">
        Tidak menerima email? <span className="font-bold text-brand">Hubungi bantuan</span>
      </button>
      {help.sheet}
    </SubPage>
  );
}

export function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex w-full items-start gap-2 rounded-[12px] bg-bad-bg p-3 text-left text-[14px] font-semibold text-bad">
      <CircleAlert size={18} className="mt-px shrink-0" />
      {msg}
    </div>
  );
}
