/** Kata sandi dari email/admin (akun baru, direset admin, lupa kata sandi) wajib diganti sebelum memakai aplikasi. */
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "../lib/nav";
import { GradientHeader } from "../components/shell";
import { Card, cx, Field, inputCls, PrimaryButton, useToast } from "../components/ui";
import { api, errMsg } from "../lib/api";
import { clearLoginPassword, heldLoginPassword } from "../lib/login-handoff";
import { logout } from "../lib/session";
import { ErrorBox } from "./Forgot";

export function ForcePasswordPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  // kata sandi yang baru dipakai masuk langsung terisi
  const [old, setOld] = useState(heldLoginPassword);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState({ old: false, pw: false, pw2: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!old) return setError("Isi kata sandi saat ini (dari email atau admin).");
    if (pw.length < 8 || !/\p{L}/u.test(pw) || !/\d/.test(pw)) return setError("Kata sandi baru minimal 8 karakter, berisi huruf dan angka.");
    if (pw === old) return setError("Kata sandi baru harus berbeda dari kata sandi saat ini.");
    if (pw !== pw2) return setError("Ulangi kata sandi baru dengan benar.");
    setBusy(true);
    setError(null);
    try {
      await api("/me/password", { body: { old_password: old, new_password: pw } });
      clearLoginPassword();
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast("Kata sandi baru tersimpan.");
      nav("/dashboard", { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof show, value: string, set: (v: string) => void, autoComplete: string, placeholder?: string) => (
    <span className="relative">
      <input value={value} onChange={(e) => set(e.target.value)} type={show[k] ? "text" : "password"} autoComplete={autoComplete} placeholder={placeholder} className={cx(inputCls, "pr-11")} />
      <button
        type="button"
        aria-label={show[k] ? "Sembunyikan" : "Tampilkan"}
        onClick={() => setShow({ ...show, [k]: !show[k] })}
        className="absolute right-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-muted"
      >
        {show[k] ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  );

  return (
    <div className="min-h-dvh">
      <GradientHeader className="pb-[110px]">
        <div className="flex flex-col items-center gap-3 px-6 pt-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/15">
            <KeyRound size={26} />
          </span>
          <h1 className="font-display text-[24px] font-bold">Buat kata sandi baru</h1>
          <p className="text-[14px] text-white/80">Ganti kata sandi dari email/admin dengan buatan sendiri sebelum memakai aplikasi.</p>
        </div>
      </GradientHeader>
      <div className="relative z-10 -mt-[80px] px-4 pb-8">
        <Card className="shadow-[var(--shadow-card)]">
          <form onSubmit={submit} className="flex flex-col gap-4 p-1" noValidate>
            <Field label="Kata sandi saat ini">{field("old", old, setOld, "current-password", "Dari email atau admin")}</Field>
            <Field label="Kata sandi baru">{field("pw", pw, setPw, "new-password", "Minimal 8 karakter, huruf dan angka")}</Field>
            <Field label="Ulangi kata sandi baru">{field("pw2", pw2, setPw2, "new-password")}</Field>
            {error && <ErrorBox msg={error} />}
            <PrimaryButton type="submit" loading={busy}>
              Simpan dan lanjutkan
            </PrimaryButton>
          </form>
        </Card>
        <button type="button" onClick={() => (clearLoginPassword(), logout())} className="mx-auto mt-5 flex items-center gap-2 text-[14px] font-bold text-muted">
          <LogOut size={16} /> Keluar
        </button>
      </div>
    </div>
  );
}
