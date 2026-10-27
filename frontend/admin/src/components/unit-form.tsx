import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Link } from "@/lib/nav";
import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import type { UnitOut, User } from "@/lib/types";
import { useToast } from "./providers";
import { ConfirmModal } from "./staff-form";
import { Button, FormRow, IconBtn, Modal, ModalHead, Select, inputCls } from "./ui";


export function UnitForm({ unit, onClose }: { unit: UnitOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const edit = !!unit;
  const [name, setName] = useState(unit?.name ?? "");
  // satu baris per Kepala Unit ("" = baris baru yang belum dipilih)
  const [heads, setHeads] = useState<string[]>(unit?.heads.length ? unit.heads.map((h) => String(h.id)) : [""]);
  const [err, setErr] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["users", "unit_head"], queryFn: () => api<User[]>("/api/v1/admin/users", { query: { role: "unit_head" } }) });
  // unit lain yang sudah dipimpin, ditampilkan sebagai keterangan pilihan
  const others = (h: User) => h.head_units.filter((n) => n !== unit?.name);
  const pickable = (list.data ?? []).filter((h) => h.is_active !== false);
  const optionsFor = (row: number) =>
    pickable
      .filter((h) => String(h.id) === heads[row] || !heads.includes(String(h.id)))
      .map((h) => ({ value: String(h.id), label: others(h).length ? `${h.name} (Kepala Unit ${others(h).join(", ")})` : h.name }));
  const chosen = heads.filter(Boolean).map(Number);
  const canAdd = !heads.includes("") && pickable.length > heads.length;
  const m = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), head_user_ids: chosen };
      return edit ? api<UnitOut>(`/api/v1/admin/units/${unit!.id}`, { method: "PUT", body }) : api<UnitOut>("/api/v1/admin/units", { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["units"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast(edit ? "Unit disimpan" : "Unit ditambahkan");
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (name.trim().length < 2) return setErr("Nama unit minimal 2 huruf.");
    if (!edit && !chosen.length) return setErr("Pilih minimal satu Kepala Unit.");
    setErr(null);
    m.mutate();
  }
  return (
    <Modal open onClose={onClose} width={460}>
      <ModalHead title={edit ? "Ubah unit" : "Tambah unit"} onClose={onClose} />
      <FormRow label="Nama unit" required>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Fisioterapi" className={inputCls} />
      </FormRow>
      <FormRow label="Kepala Unit" required={!edit}>
        {list.isSuccess && !list.data.some((h) => h.is_active !== false) ? (
          <span className="rounded-lg border border-line bg-soft px-3 py-2.5 text-[13px] text-muted">
            Belum ada akun Kepala Unit.{" "}
            <Link href="/admins" className="font-medium text-brand">
              Buat di Kelola Admin
            </Link>
          </span>
        ) : (
          <div className="flex flex-col gap-2">
            {heads.map((h, row) => (
              <div key={row} className="flex items-center gap-2">
                <Select
                  big
                  className="min-w-0 flex-1"
                  value={h}
                  onChange={(v) => setHeads(heads.map((x, k) => (k === row ? v : x)))}
                  options={[{ value: "", label: "Pilih Kepala Unit" }, ...optionsFor(row)]}
                />
                <IconBtn label="Hapus Kepala Unit" onClick={() => setHeads(heads.length > 1 ? heads.filter((_, k) => k !== row) : [""])}>
                  <X size={16} />
                </IconBtn>
              </div>
            ))}
            {canAdd && (
              <button type="button" onClick={() => setHeads([...heads, ""])} className="flex items-center gap-1.5 self-start py-1 text-[13px] font-medium text-brand hover:text-brand-dark">
                <Plus size={15} /> Tambah Kepala Unit
              </button>
            )}
          </div>
        )}
      </FormRow>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} onClick={submit}>
          {edit ? "Simpan" : "Tambah unit"}
        </Button>
      </div>
    </Modal>
  );
}

/** Konfirmasi hapus unit (ditolak server bila unit masih punya karyawan). */
export function DeleteUnitModal({ unit, onClose, onDeleted }: { unit: UnitOut; onClose: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/admin/units/${unit.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["units"] });
      toast("Unit dihapus");
      onClose();
      onDeleted?.();
    },
    onError: (e) => {
      toast(errMsg(e));
      onClose();
    },
  });
  return (
    <ConfirmModal
      title={`Hapus unit ${unit.name}?`}
      body={unit.staff_count ? `Unit ini masih punya ${unit.staff_count} karyawan. Pindahkan karyawan dulu sebelum menghapus.` : "Unit akan dihapus dari daftar."}
      confirm="Hapus unit"
      danger
      loading={remove.isPending}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    />
  );
}
