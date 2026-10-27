import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/status";
import type { CreatedUserOut, CredentialResult, Role, User } from "@/lib/types";
import { CredentialNotice } from "./credentials";
import { useToast } from "./providers";
import { PhoneInput, validEmail, validPhone } from "./staff-form";
import { Link } from "@/lib/nav";
import { Button, FormRow, Modal, ModalHead, Segmented, inputCls } from "./ui";

type AdminRole = Exclude<Role, "staff">;

export function AdminForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const edit = !!user;
  const [f, setF] = useState({
    role: (user?.role ?? "unit_head") as AdminRole,
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: (user?.phone ?? "").replace(/\D/g, "").replace(/^62/, "").replace(/^0/, ""),
  });
  const [created, setCreated] = useState<{ name: string; email: string | null; result: CredentialResult } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        email: f.email.trim().toLowerCase(),
        phone: `+62${f.phone}`,
        role: f.role,
        // unit yang dipimpin Kepala Unit diatur di Kelola Unit; Admin SDM tidak terikat unit
        ...(f.role === "unit_head" ? {} : { unit: null }),
      };
      if (edit) return api<User>(`/api/v1/admin/users/${user!.id}`, { method: "PUT", body }).then(() => null);
      return api<CreatedUserOut>("/api/v1/admin/users", { body: { ...body, employee_code: body.email, employment_type: "tetap" } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["units"] });
      if (res) setCreated({ name: res.user.name, email: res.user.email, result: res.credentials });
      else {
        toast("Akun admin disimpan");
        onClose();
      }
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (f.name.trim().length < 3) return setErr("Nama minimal 3 huruf.");
    if (!validEmail(f.email)) return setErr("Format email tidak valid.");
    if (!validPhone(f.phone)) return setErr("Nomor HP diawali 8, 9–13 digit setelah +62.");
    setErr(null);
    m.mutate();
  }
  const self = user?.id === s.me.user.id;
  if (created) {
    return (
      <CredentialNotice
        name={created.name}
        email={created.email}
        result={created.result}
        onClose={() => {
          toast(`Akun ${created.name} dibuat`);
          onClose();
        }}
      />
    );
  }
  return (
    <Modal open onClose={onClose} width={480} top={80}>
      <ModalHead title={edit ? "Ubah akun admin" : "Tambah admin"} sub={edit ? user!.name : undefined} onClose={onClose} />
      <FormRow label="Peran" required>
        {self ? (
          <span className="text-[13px] text-muted">{ROLE_LABEL[f.role]}</span>
        ) : (
          <Segmented
            value={f.role}
            onChange={(v) => setF({ ...f, role: v })}
            options={[
              { value: "unit_head", label: "Kepala Unit" },
              { value: "admin", label: "Admin SDM" },
            ]}
          />
        )}
      </FormRow>
      <FormRow label="Nama lengkap" required>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} />
      </FormRow>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Email" required>
          <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nama@awalbros.cc" className={inputCls} />
        </FormRow>
        <FormRow label="Nomor HP" required>
          <PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
        </FormRow>
      </div>
      {f.role === "unit_head" && (
        <span className="text-[13px] text-muted">
          {edit && user!.head_units.length ? `Memimpin ${user!.head_units.join(", ")}. ` : ""}Unit yang dipimpin diatur di{" "}
          <Link href="/units" className="font-medium text-brand" onClick={onClose}>
            Kelola Unit
          </Link>
          .
        </span>
      )}
      {err && <span className="text-[13px] text-bad">{err}</span>}
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

/** Aktifkan / nonaktifkan akun admin (Admin SDM). */
export function useToggleAccount() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (u: User) => api<User>(`/api/v1/admin/users/${u.id}`, { method: "PUT", body: { is_active: u.is_active === false } }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["units"] });
      toast(`${u.name} ${u.is_active === false ? "dinonaktifkan" : "diaktifkan"}`);
    },
    onError: (e) => toast(errMsg(e)),
  });
}
