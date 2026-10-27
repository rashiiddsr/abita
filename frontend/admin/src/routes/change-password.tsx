import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, Lock, LogOut } from "lucide-react";
import { useRouter } from "@/lib/nav";
import { useState, type FormEvent } from "react";
import { AuthAlert, AuthButton, AuthField, AuthShell } from "@/components/auth-shell";
import { api, errMsg } from "@/lib/api";
import { clearLoginPassword, heldLoginPassword } from "@/lib/login-handoff";
import type { Me } from "@/lib/types";

export const Route = createFileRoute("/change-password")({ component: GantiSandiPage });

/** Wajib setelah akun dibuat, direset admin, atau lupa kata sandi: ganti kata sandi dari email/admin dengan buatan sendiri. */
function GantiSandiPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/v1/me") });
  // kata sandi yang baru dipakai masuk langsung terisi
  const [pw, setPw] = useState(() => ({ old: heldLoginPassword(), a: "", b: "" }));
  const [show, setShow] = useState({ old: false, a: false, b: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pw.old) return setErr("Isi kata sandi saat ini.");
    if (pw.a.length < 8) return setErr("Kata sandi baru minimal 8 karakter.");
    if (!/[a-z]/i.test(pw.a) || !/\d/.test(pw.a)) return setErr("Kata sandi baru harus memuat huruf dan angka.");
    if (pw.a === pw.old) return setErr("Kata sandi baru harus berbeda dari kata sandi saat ini.");
    if (pw.a !== pw.b) return setErr("Konfirmasi kata sandi tidak sama.");
    setBusy(true);
    setErr(null);
    try {
      await api("/api/v1/me/password", { body: { old_password: pw.old, new_password: pw.a } });
      clearLoginPassword();
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    clearLoginPassword();
    qc.clear();
    router.replace("/login");
  }

  const type = (k: keyof typeof show) => (show[k] ? "text" : "password");
  const eye = (k: keyof typeof show) => (
    <button type="button" onClick={() => setShow({ ...show, [k]: !show[k] })} aria-label={show[k] ? "Sembunyikan" : "Tampilkan"} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-soft">
      {show[k] ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
  return (
    <AuthShell title="Buat kata sandi baru" sub={me.data ? `Masuk sebagai ${me.data.user.email ?? me.data.user.name}` : undefined} onSubmit={submit}>
      {err && <AuthAlert tone="error" title={err} />}
      <AuthField
        label="Kata sandi saat ini"
        icon={<KeyRound size={18} />}
        type={type("old")}
        value={pw.old}
        onChange={(e) => setPw({ ...pw, old: e.target.value })}
        placeholder="Dari email atau admin"
        autoComplete="current-password"
        right={eye("old")}
      />
      <AuthField
        label="Kata sandi baru"
        icon={<Lock size={18} />}
        type={type("a")}
        value={pw.a}
        onChange={(e) => setPw({ ...pw, a: e.target.value })}
        placeholder="Minimal 8 karakter, huruf dan angka"
        autoComplete="new-password"
        right={eye("a")}
      />
      <AuthField label="Ulangi kata sandi baru" icon={<Lock size={18} />} type={type("b")} value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} autoComplete="new-password" right={eye("b")} />
      <AuthButton busy={busy}>Simpan dan lanjutkan</AuthButton>
      <button type="button" onClick={logout} className="flex items-center justify-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <LogOut size={15} /> Keluar
      </button>
    </AuthShell>
  );
}
