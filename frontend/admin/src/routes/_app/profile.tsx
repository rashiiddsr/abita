import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Eye, EyeOff, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "@/components/providers";
import { Page } from "@/components/shell";
import { PhoneInput, validPhone } from "@/components/staff-form";
import { Avatar, Button, Card, FormRow, PageHeader, cx, inputCls } from "@/components/ui";
import { ApiError, api, apiUrl, errMsg } from "@/lib/api";
import { bumpAvatar } from "@/lib/avatar-version";
import { useSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/status";

export const Route = createFileRoute("/_app/profile")({ component: ProfilPage });

const digits = (p: string | null) => (p ?? "").replace(/\D/g, "").replace(/^62/, "").replace(/^0/, "");

function ProfilPage() {
  const s = useSession();
  const u = s.me.user;
  return (
    <Page className="mx-auto max-w-4xl">
      <PageHeader title="Profil" />
      <ProfileCard key={`${u.id}-${u.name}-${u.email}-${u.phone}`} />
      <PasswordCard />
    </Page>
  );
}

function ProfileCard() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const u = s.me.user;
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: u.name, email: u.email ?? "", phone: digits(u.phone) });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const dirty = f.name !== u.name || f.email !== (u.email ?? "") || f.phone !== digits(u.phone);

  const save = useMutation({
    mutationFn: () => api("/api/v1/me/profile", { method: "PUT", body: { name: f.name.trim(), email: f.email.trim(), phone: `+62${f.phone}` } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast("Profil disimpan");
    },
    onError: (e) => setErrs({ form: errMsg(e) }),
  });
  const photo = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return api("/api/v1/me/avatar", { method: "DELETE" });
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch(apiUrl("/api/v1/me/avatar"), { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, (body && typeof body.detail === "string" && body.detail) || "Foto gagal diunggah.");
      }
    },
    onSuccess: (_d, file) => {
      bumpAvatar();
      qc.invalidateQueries({ queryKey: ["me"] });
      toast(file ? "Foto profil diperbarui" : "Foto profil dihapus");
    },
    onError: (e) => toast(errMsg(e)),
  });

  function submit() {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 3) e.name = "Nama minimal 3 huruf.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = "Format email tidak valid.";
    if (!validPhone(f.phone)) e.phone = "Diawali 8, 9–13 digit setelah +62.";
    setErrs(e);
    if (Object.keys(e).length === 0) save.mutate();
  }
  const err = (k: string) => (errs[k] ? "border-bad focus:border-bad focus:ring-bad/15" : "");

  return (
    <Card enterScope>
      <div className="flex flex-wrap items-center gap-4 border-b border-line p-5">
        <div className="relative">
          <Avatar name={u.name} size={72} bg="#004650" fg="#FFFFFF" userId={u.id} photo={u.has_avatar} />
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Ganti foto profil"
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-white bg-strong text-on-strong hover:bg-brand-dark"
          >
            <Camera size={13} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 3 * 1024 * 1024) return toast("Ukuran foto maksimal 3 MB");
              photo.mutate(file);
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold">{u.name}</span>
          <span className="text-[13px] text-muted">
            {ROLE_LABEL[u.role]} · {s.isGlobal ? "Semua unit" : (u.unit ?? "—")}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" loading={photo.isPending && photo.variables !== null} onClick={() => fileRef.current?.click()}>
            Ganti foto
          </Button>
          {u.has_avatar && (
            <Button variant="dangerOutline" size="sm" onClick={() => photo.mutate(null)}>
              <Trash2 size={14} /> Hapus
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <FormRow label="Nama lengkap" required error={errs.name}>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={cx(inputCls, err("name"))} />
        </FormRow>
        <FormRow label="Unit">
          <input value={s.isGlobal ? "Semua unit" : (u.unit ?? "—")} disabled className={cx(inputCls, "bg-soft text-muted")} />
        </FormRow>
        <FormRow label="Email" required error={errs.email}>
          <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={cx(inputCls, err("email"))} />
        </FormRow>
        <FormRow label="Nomor HP" required error={errs.phone}>
          <PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} invalid={!!errs.phone} />
        </FormRow>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        {errs.form && <span className="mr-auto text-[13px] text-bad">{errs.form}</span>}
        <Button variant="outline" disabled={!dirty} onClick={() => (setF({ name: u.name, email: u.email ?? "", phone: digits(u.phone) }), setErrs({}))}>
          Batal
        </Button>
        <Button data-submit disabled={!dirty} loading={save.isPending} onClick={submit}>
          Simpan
        </Button>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [pw, setPw] = useState({ old: "", new1: "", new2: "" });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api("/api/v1/me/password", { body: { old_password: pw.old, new_password: pw.new1 } }),
    onSuccess: () => {
      setPw({ old: "", new1: "", new2: "" });
      toast("Kata sandi diubah");
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (!pw.old) return setErr("Isi kata sandi saat ini.");
    if (pw.new1.length < 8) return setErr("Kata sandi baru minimal 8 karakter.");
    if (pw.new1 !== pw.new2) return setErr("Konfirmasi kata sandi tidak sama.");
    setErr(null);
    m.mutate();
  }
  const type = show ? "text" : "password";
  return (
    <Card enterScope>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <span className="text-[15px] font-semibold">Kata sandi</span>
        <button onClick={() => setShow(!show)} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
          {show ? "Sembunyikan" : "Tampilkan"}
        </button>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <FormRow label="Kata sandi saat ini">
          <input type={type} value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} autoComplete="current-password" className={inputCls} />
        </FormRow>
        <FormRow label="Kata sandi baru">
          <input type={type} value={pw.new1} onChange={(e) => setPw({ ...pw, new1: e.target.value })} autoComplete="new-password" placeholder="Minimal 8 karakter" className={inputCls} />
        </FormRow>
        <FormRow label="Ulangi kata sandi baru">
          <input type={type} value={pw.new2} onChange={(e) => setPw({ ...pw, new2: e.target.value })} autoComplete="new-password" className={inputCls} />
        </FormRow>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        {err && <span className="mr-auto text-[13px] text-bad">{err}</span>}
        <Button data-submit disabled={!pw.old && !pw.new1} loading={m.isPending} onClick={submit}>
          Ubah kata sandi
        </Button>
      </div>
    </Card>
  );
}
