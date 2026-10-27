import { createFileRoute, redirect } from "@tanstack/react-router";
import { Check, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { Link, useRouter } from "@/lib/nav";
import { useEffect, useState, type FormEvent } from "react";
import { AuthAlert, AuthButton, AuthField, AuthShell, EMAIL_RE } from "@/components/auth-shell";
import { cx } from "@/components/ui";
import { ApiError, api, apiUrl } from "@/lib/api";
import { holdLoginPassword } from "@/lib/login-handoff";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/login")({
  // sudah masuk sebagai Admin SDM / Kepala Unit -> langsung ke dashboard (sesi karyawan tetap boleh masuk ulang di sini)
  beforeLoad: async () => {
    const r = await fetch(apiUrl("/api/v1/me"), { credentials: "include", cache: "no-store" }).catch(() => null);
    const me = r?.ok ? ((await r.json().catch(() => null)) as Me | null) : null;
    if (me && me.user.role !== "staff") throw redirect({ to: "/dashboard", replace: true });
  },
  component: LoginPage,
});


function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // halaman disimpan tersembunyi saat berpindah rute: kosongkan kata sandi & pesan saat ditinggalkan
  useEffect(
    () => () => {
      setPass("");
      setMsg(null);
      setShow(false);
    },
    [],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setMsg("Email tidak valid");
    if (!pass) return setMsg("Masukkan kata sandi");
    setBusy(true);
    setMsg(null);
    try {
      const u = await api<{ must_change_password?: boolean }>("/api/v1/auth/web-login", { body: { employee_code: email.trim().toLowerCase(), password: pass, remember } });
      if (u.must_change_password) holdLoginPassword(pass);
      router.replace(u.must_change_password ? "/change-password" : "/dashboard");
      router.refresh();
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      if (st === 401) setMsg("Email atau kata sandi salah");
      else if (st === 403 && err instanceof ApiError && err.message.includes("tidak aktif")) setMsg("Akun tidak aktif");
      else setMsg(err instanceof Error ? err.message : "Tidak bisa masuk");
    } finally {
      setBusy(false);
    }
  }

  const bad = !!msg;
  return (
    <AuthShell title="Masuk" onSubmit={submit}>
      {msg && <AuthAlert tone="error" title={msg} />}
      <AuthField
        label="Email"
        icon={<Mail size={18} />}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="nama@awalbros.cc"
        autoComplete="email"
        invalid={bad}
      />
      <AuthField
        label="Kata sandi"
        icon={<Lock size={18} />}
        type={show ? "text" : "password"}
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        placeholder="Masukkan kata sandi"
        autoComplete="current-password"
        invalid={bad}
        right={
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-soft"
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        }
      />
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setRemember(!remember)} className="flex items-center gap-2 text-[13.5px]">
          <span className={cx("flex size-[18px] items-center justify-center rounded text-white", remember ? "bg-brand" : "border border-off bg-card")}>
            {remember && <Check size={13} strokeWidth={3} />}
          </span>
          Ingat saya
        </button>
        <Link href="/forgot-password" className="text-[13px] font-medium text-brand hover:text-brand-dark">
          Lupa kata sandi?
        </Link>
      </div>
      <AuthButton busy={busy}>Masuk</AuthButton>
    </AuthShell>
  );
}
