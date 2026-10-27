import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Eye, EyeOff, IdCard, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "../lib/nav";
import { AbitaMark, OrgLogo } from "../components/brand";
import { useHelpdesk } from "../components/helpdesk";
import { GradientHeader } from "../components/shell";
import { Card, cx, Field, inputCls, PrimaryButton, Spinner } from "../components/ui";
import { ApiError, api, errMsg } from "../lib/api";
import { holdLoginPassword } from "../lib/login-handoff";
import { useConfig, useMe } from "../lib/session";
import type { User } from "../lib/types";

const LAST = "abita.lastIdent";

export function LoginPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const cfg = useConfig();
  const help = useHelpdesk("Halo Admin SDM, saya kesulitan masuk ke aplikasi ABiTA.");
  const [ident, setIdent] = useState(() => {
    try {
      return localStorage.getItem(LAST) ?? "";
    } catch {
      return "";
    }
  });
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = useMe();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ident.trim() || !pw) return setError("Isi email/NIK dan kata sandi.");
    setBusy(true);
    setError(null);
    try {
      const u = await api<User>("/auth/app-login", { body: { employee_code: ident.trim(), password: pw, remember } });
      try {
        localStorage.setItem(LAST, ident.trim());
      } catch {
        /* abaikan */
      }
      qc.clear();
      if (u.must_change_password) holdLoginPassword(pw);
      nav(u.must_change_password ? "/change-password" : "/dashboard", { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  // sudah masuk (mis. ikon layar utama dibuka lagi di halaman ini): langsung ke aplikasi, tidak perlu masuk ulang
  if (me.data?.user.role === "staff") return <Navigate to="/dashboard" replace />;
  if (me.error instanceof ApiError && me.error.status === 403 && /buat kata sandi baru/i.test(me.error.message)) return <Navigate to="/change-password" replace />;
  if (me.isPending)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <AbitaMark size={56} />
        <Spinner />
      </div>
    );

  return (
    <div className="min-h-dvh">
      <GradientHeader className="pb-[120px]">
        <div className="flex flex-col items-center px-4 pt-6">
          <OrgLogo org={cfg.data?.org_name ?? "RS Awal Bros Botania"} />
          <h1 className="font-display mt-6 text-[30px] font-bold leading-tight">Masuk</h1>
        </div>
      </GradientHeader>
      <div className="relative z-10 -mt-[86px] px-4 pb-8">
        <Card className="shadow-[var(--shadow-card)]">
          <form onSubmit={submit} className="flex flex-col gap-4 p-1" noValidate>
            <Field label="Email atau NIK">
              <span className="relative">
                <IdCard size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
                <input value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="nama@email.com atau NIK" className={cx(inputCls, "pl-11")} />
              </span>
            </Field>
            <Field label="Kata sandi">
              <span className="relative">
                <Lock size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
                <input value={pw} onChange={(e) => setPw(e.target.value)} type={show ? "text" : "password"} autoComplete="current-password" placeholder="Masukkan kata sandi" className={cx(inputCls, "px-11")} />
                <button type="button" aria-label={show ? "Sembunyikan" : "Tampilkan"} onClick={() => setShow(!show)} className="absolute right-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-muted">
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </Field>
            <label className="flex items-center gap-2.5 text-[14px] font-semibold text-ink">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-5 accent-[var(--brand)]" />
              Ingat saya
            </label>
            {error && (
              <div className="flex items-start gap-2 rounded-[12px] bg-bad-bg p-3 text-[14px] font-semibold text-bad">
                <CircleAlert size={18} className="mt-px shrink-0" />
                {error}
              </div>
            )}
            <PrimaryButton type="submit" loading={busy}>
              {busy ? "Memproses…" : "Masuk"}
            </PrimaryButton>
            <Link to="/forgot-password" className="mx-auto py-1 text-[14px] font-bold text-brand">
              Lupa kata sandi?
            </Link>
          </form>
        </Card>
        <button type="button" onClick={help.openHelp} className="mx-auto mt-5 block text-[14px] text-muted">
          Kesulitan masuk? <span className="font-bold text-brand">Hubungi bantuan</span>
        </button>
        {help.sheet}
      </div>
    </div>
  );
}
