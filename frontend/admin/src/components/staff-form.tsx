import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { CreatedUserOut, CredentialResult, User } from "@/lib/types";
import { CredentialNotice } from "./credentials";
import { useToast } from "./providers";
import { Button, FormRow, Modal, ModalHead, Segmented, Select, cx, inputCls } from "./ui";

const phoneDigits = (p: string | null) => (p ?? "").replace(/\D/g, "").replace(/^62/, "").replace(/^0/, "");

/** Input nomor HP dengan awalan +62 (hanya angka). */
export function PhoneInput({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <span
      className={cx(
        "flex h-10 items-center rounded-lg border bg-card pl-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15",
        invalid ? "border-bad" : "border-line",
      )}
    >
      <span className="text-sm text-muted">+62</span>
      <input
        value={value}
        inputMode="numeric"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 13))}
        placeholder="812 3456 7890"
        className="h-full w-full bg-transparent px-2 text-sm outline-none"
      />
    </span>
  );
}

export const validPhone = (p: string) => p.startsWith("8") && p.length >= 9 && p.length <= 13;
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

/** Tambah / ubah karyawan. Kata sandi dibuat sistem dan dikirim ke email karyawan. */
export function StaffFormModal({ user, onClose }: { user?: User | null; onClose: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const edit = !!user;
  const [f, setF] = useState({
    name: user?.name ?? "",
    employee_code: user?.employee_code ?? "",
    email: user?.email ?? "",
    phone: phoneDigits(user?.phone ?? null),
    employment_type: user?.employment_type ?? "magang",
    unit: s.ownUnit ?? user?.unit ?? (s.scope !== "all" ? s.scope : (s.units[0]?.name ?? "")),
    institution: user?.institution ?? "",
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string | null; result: CredentialResult } | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const m = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        email: f.email.trim().toLowerCase(),
        phone: `+62${f.phone}`,
        employment_type: f.employment_type,
        unit: f.unit || null,
        institution: f.institution.trim(),
      };
      if (edit) {
        await api<User>(`/api/v1/admin/users/${user!.id}`, { method: "PUT", body });
        return null;
      }
      return api<CreatedUserOut>("/api/v1/admin/users", { body: { ...body, employee_code: f.employee_code.trim(), role: "staff" } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["units"] });
      qc.invalidateQueries({ queryKey: ["staff-detail"] });
      if (res) setCreated({ name: res.user.name, email: res.user.email, result: res.credentials });
      else {
        toast("Data karyawan disimpan");
        onClose();
      }
    },
    onError: (e) => setErr(errMsg(e)),
  });

  function submit() {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 3) e.name = "Nama minimal 3 huruf.";
    if (!edit && !f.employee_code.trim()) e.employee_code = "NIK wajib diisi.";
    if (!validEmail(f.email)) e.email = "Format email tidak valid.";
    if (!validPhone(f.phone)) e.phone = "Diawali 8, 9–13 digit setelah +62.";
    if (!f.unit) e.unit = "Pilih unit.";
    if (!f.institution.trim()) e.institution = "Wajib diisi.";
    setErrs(e);
    setErr(null);
    if (Object.keys(e).length === 0) m.mutate();
  }
  const bad = (k: string) => (errs[k] ? "border-bad focus:border-bad focus:ring-bad/15" : "");

  if (created) {
    return (
      <CredentialNotice
        name={created.name}
        email={created.email}
        result={created.result}
        onClose={() => {
          toast(`Akun ${created.name.split(" ")[0]} dibuat`);
          onClose();
        }}
      />
    );
  }

  return (
    <Modal open onClose={onClose} width={560} top={60}>
      <ModalHead title={edit ? "Ubah data karyawan" : "Tambah karyawan"} sub={edit ? user!.name : undefined} onClose={onClose} />
      <div className="grid gap-4 sm:grid-cols-2">
        {!edit && (
          <FormRow label="NIK" required error={errs.employee_code}>
            <input
              value={f.employee_code}
              onChange={(e) => set("employee_code")(e.target.value.replace(/\D/g, "").slice(0, 40))} // NIK hanya angka
              inputMode="numeric"
              placeholder="Contoh: 20260501"
              className={cx(inputCls, bad("employee_code"))}
            />
          </FormRow>
        )}
        <FormRow label="Nama lengkap" required error={errs.name}>
          <input value={f.name} onChange={(e) => set("name")(e.target.value)} className={cx(inputCls, bad("name"))} />
        </FormRow>
        <FormRow label="Email" required error={errs.email}>
          <input value={f.email} onChange={(e) => set("email")(e.target.value)} placeholder="nama@email.com" className={cx(inputCls, bad("email"))} />
        </FormRow>
        <FormRow label="Nomor HP" required error={errs.phone}>
          <PhoneInput value={f.phone} onChange={set("phone")} invalid={!!errs.phone} />
        </FormRow>
      </div>
      <FormRow label="Tipe karyawan" required>
        <Segmented
          value={f.employment_type}
          onChange={set("employment_type")}
          options={[
            { value: "magang", label: "Magang/PKL" },
            { value: "outsourcing", label: "Outsourcing" },
          ]}
        />
      </FormRow>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Unit" required error={errs.unit}>
          {s.ownUnit ? (
            // Kepala Unit hanya menambah / mengubah karyawan di unitnya sendiri
            <input value={s.ownUnit} disabled className={cx(inputCls, "bg-soft text-muted")} />
          ) : (
            <Select big value={f.unit} onChange={set("unit")} options={[{ value: "", label: "Pilih unit" }, ...s.units.map((u) => ({ value: u.name, label: u.name }))]} />
          )}
        </FormRow>
        <FormRow label={f.employment_type === "magang" ? "Institusi pendidikan" : "Vendor"} required error={errs.institution}>
          <input value={f.institution} onChange={(e) => set("institution")(e.target.value)} className={cx(inputCls, bad("institution"))} />
        </FormRow>
      </div>
      {err && <div className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">{err}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} onClick={submit}>
          {edit ? "Simpan" : "Buat akun"}
        </Button>
      </div>
    </Modal>
  );
}

/** Konfirmasi sederhana (nonaktifkan / reset wajah / hapus). */
export function ConfirmModal({
  title,
  body,
  confirm,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose}>
      <ModalHead title={title} onClose={onClose} />
      <span className="text-[13px] text-muted">{body}</span>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
          {confirm}
        </Button>
      </div>
    </Modal>
  );
}
