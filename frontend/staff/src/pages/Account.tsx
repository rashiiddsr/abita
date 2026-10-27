/** Pengaturan akun: data diri, kata sandi, data wajah presensi. */
import { useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronRight, IdCard, KeyRound, Mail, ScanFace, Smartphone, User } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "../lib/nav";
import { SubPage } from "../components/shell";
import { cx, Field, inputCls, ListGroup, ListRow, PrimaryButton, SectionLabel, Sheet, useToast } from "../components/ui";
import { api, errMsg } from "../lib/api";
import { fmtDateMed, phoneDisplay } from "../lib/format";
import { useMe } from "../lib/session";

// nama karyawan hanya diubah Admin SDM / Kepala Unit; email & nomor HP bisa diubah sendiri
type FieldKey = "email" | "phone";

export function AccountPage() {
  const me = useMe();
  const nav = useNavigate();
  const [edit, setEdit] = useState<FieldKey | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  if (!me.data) return null;
  const u = me.data.user;
  const val = (v: string | null) => <span className="max-w-[55%] truncate text-[14px] font-semibold text-muted">{v || "-"}</span>;
  // baris yang bisa diubah: nilai + tanda ›
  const editable = (v: string | null) => (
    <span className="flex max-w-[60%] items-center gap-1">
      <span className="truncate text-[14px] font-semibold text-muted">{v || "-"}</span>
      <ChevronRight size={18} className="shrink-0 text-faint" />
    </span>
  );
  return (
    <SubPage title="Pengaturan akun">
      <SectionLabel>Data diri</SectionLabel>
      <ListGroup>
        <ListRow icon={<IdCard size={19} />} title="NIK" trailing={val(u.employee_code)} />
        <ListRow icon={<User size={19} />} title="Nama" trailing={val(u.name)} />
        <ListRow icon={<Mail size={19} />} title="Email" trailing={editable(u.email)} onClick={() => setEdit("email")} />
        <ListRow icon={<Smartphone size={19} />} title="Nomor HP" trailing={editable(u.phone ? phoneDisplay(u.phone) : null)} onClick={() => setEdit("phone")} />
        <ListRow icon={<Building2 size={19} />} title="Unit" trailing={val(u.unit)} />
      </ListGroup>
      <SectionLabel>Keamanan</SectionLabel>
      <ListGroup>
        <ListRow icon={<KeyRound size={19} />} title="Kata sandi" subtitle="••••••••" onClick={() => setPwOpen(true)} />
        <ListRow
          icon={<ScanFace size={19} />}
          title="Data wajah presensi"
          subtitle={u.face_enrolled_at ? `Terdaftar ${fmtDateMed(u.face_enrolled_at.slice(0, 10))}` : "Belum terdaftar"}
          trailing={
            <button type="button" onClick={() => nav("/rescan-face")} className="h-9 rounded-full bg-brand-soft px-3.5 text-[13px] font-bold text-brand">
              Pindai ulang
            </button>
          }
        />
      </ListGroup>
      <EditSheet field={edit} onClose={() => setEdit(null)} />
      <PasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />
    </SubPage>
  );
}

function EditSheet({ field, onClose }: { field: FieldKey | null; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const u = me.data?.user;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<FieldKey | null>(null);
  if (field !== opened) {
    setOpened(field);
    setError(null);
    setValue(field === "email" ? (u?.email ?? "") :(u?.phone ?? "").replace(/\D/g, "").replace(/^62/, ""));
  }
  const save = async () => {
    if (!u || !field) return;
    if (field === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())) return setError("Format email tidak valid.");
    if (field === "phone" && value && !/^8\d{8,12}$/.test(value)) return setError("Nomor HP diawali 8, 9–13 digit setelah +62.");
    setBusy(true);
    setError(null);
    try {
      await api("/me/profile", {
        method: "PUT",
        body: {
          email: field === "email" ? value.trim() || null : u.email,
          phone: field === "phone" ? (value ? `+62${value}` : null) : u.phone,
        },
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast("Tersimpan.");
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const title = field === "email" ? "Ubah email" : "Ubah nomor HP";
  return (
    <Sheet open={!!field} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4 pt-2">
        {field === "phone" ? (
          <Field label="Nomor HP (WhatsApp)">
            <span className="flex items-center rounded-[14px] bg-soft focus-within:ring-2 focus-within:ring-brand/15">
              <span className="pl-4 text-[16px] font-bold">+62</span>
              <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 13))} inputMode="numeric" placeholder="812 3456 7890" className={cx(inputCls, "bg-transparent pl-2 focus:bg-transparent focus:ring-0")} />
            </span>
          </Field>
        ) : (
          <Field label="Email">
            <input value={value} onChange={(e) => setValue(e.target.value)} type="email" placeholder="nama@email.com" className={inputCls} />
          </Field>
        )}
        {error && <span className="text-[14px] font-semibold text-bad">{error}</span>}
        <PrimaryButton data-submit loading={busy} onClick={save}>
          Simpan
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [old, setOld] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (pw.length < 8 || !/\p{L}/u.test(pw) || !/\d/.test(pw)) return setError("Minimal 8 karakter, berisi huruf dan angka.");
    if (pw !== pw2) return setError("Ulangi kata sandi baru dengan benar.");
    setBusy(true);
    setError(null);
    try {
      await api("/me/password", { body: { old_password: old, new_password: pw } });
      toast("Kata sandi diperbarui.");
      setOld("");
      setPw("");
      setPw2("");
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Ubah kata sandi">
      <div className="flex flex-col gap-4 pt-2">
        <Field label="Kata sandi lama">
          <input value={old} onChange={(e) => setOld(e.target.value)} type="password" autoComplete="current-password" className={inputCls} />
        </Field>
        <Field label="Kata sandi baru">
          <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="new-password" placeholder="Minimal 8 karakter, huruf dan angka" className={inputCls} />
        </Field>
        <Field label="Ulangi kata sandi baru">
          <input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" autoComplete="new-password" className={inputCls} />
        </Field>
        {error && <span className="text-[14px] font-semibold text-bad">{error}</span>}
        <PrimaryButton data-submit loading={busy} onClick={save}>
          Simpan
        </PrimaryButton>
      </div>
    </Sheet>
  );
}
