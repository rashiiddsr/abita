import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import { todayWib } from "@/lib/format";
import { tipe } from "@/lib/status";
import type { EmploymentType, FolderOut, UnitOut } from "@/lib/types";
import { useRefreshFiles } from "./files";
import { useToast } from "./providers";
import { ConfirmModal } from "./staff-form";
import { Button, Checkbox, FormRow, inputCls, Modal, ModalHead, Segmented, textareaCls } from "./ui";

const TYPES: EmploymentType[] = ["tetap", "outsourcing", "magang"];

/** "Semua karyawan" atau ringkasan kriteria penerima folder. */
export function audienceLabel(f: Pick<FolderOut, "units" | "employment_types">): string {
  const parts = [...f.units, ...f.employment_types.map((t) => tipe(t).label)];
  return parts.length ? parts.join(", ") : "Semua karyawan";
}

export function FolderForm({ folder, onClose, onSaved }: { folder: FolderOut | null; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast();
  const refresh = useRefreshFiles();
  const [name, setName] = useState(folder?.name ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [from, setFrom] = useState(folder?.available_from ?? "");
  const [scope, setScope] = useState<"all" | "some">(folder && (folder.units.length || folder.employment_types.length) ? "some" : "all");
  const [units, setUnits] = useState<string[]>(folder?.units ?? []);
  const [types, setTypes] = useState<EmploymentType[]>(folder?.employment_types ?? []);
  const [remind, setRemind] = useState(folder?.reminder_date ?? "");
  const [remindMsg, setRemindMsg] = useState(folder?.reminder_message ?? "");
  const [err, setErr] = useState<string | null>(null);
  const unitList = useQuery({ queryKey: ["units"], queryFn: () => api<UnitOut[]>("/api/v1/admin/units"), enabled: scope === "some" });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const m = useMutation({
    mutationFn: () => {
      const some = scope === "some";
      const body = { name: name.trim(), description: description.trim() || null, available_from: from || null, units: some ? units : [], employment_types: some ? types : [], reminder_date: remind || null, reminder_message: remind ? remindMsg.trim() || null : null };
      return folder ? api<FolderOut>(`/api/v1/admin/folders/${folder.id}`, { method: "PUT", body }) : api<FolderOut>("/api/v1/admin/folders", { body });
    },
    onSuccess: () => {
      refresh();
      toast(folder ? "Folder disimpan" : "Folder dibuat");
      onSaved?.();
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const submit = () => {
    if (!name.trim()) return setErr("Isi nama folder.");
    if (scope === "some" && !units.length && !types.length) return setErr("Pilih minimal satu unit atau tipe karyawan.");
    setErr(null);
    m.mutate();
  };
  return (
    <Modal open onClose={onClose} width={500}>
      <ModalHead title={folder ? "Ubah folder" : "Folder baru"} onClose={onClose} />
      <FormRow label="Nama folder" required>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: SOP Pelayanan" className={inputCls} />
      </FormRow>
      <FormRow label="Deskripsi">
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={textareaCls} />
      </FormRow>
      <FormRow label="Tampil mulai">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls + " tnum"} />
      </FormRow>
      <FormRow label="Penerima">
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "Semua karyawan" },
            { value: "some", label: "Pilih kriteria" },
          ]}
        />
      </FormRow>
      {scope === "some" && (
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <FormRow label="Unit">
            <div className="flex max-h-[180px] flex-col overflow-y-auto rounded-lg border border-line px-3 py-1">
              {(unitList.data ?? []).map((u) => (
                <Checkbox key={u.id} on={units.includes(u.name)} onChange={() => setUnits(toggle(units, u.name))}>
                  {u.name}
                </Checkbox>
              ))}
            </div>
          </FormRow>
          <FormRow label="Tipe karyawan">
            <div className="flex flex-col rounded-lg border border-line px-3 py-1">
              {TYPES.map((t) => (
                <Checkbox key={t} on={types.includes(t)} onChange={() => setTypes(toggle(types, t))}>
                  {tipe(t).label}
                </Checkbox>
              ))}
            </div>
          </FormRow>
        </div>
      )}
      <FormRow label="Pengingat" hint={folder?.reminder_sent && remind === folder.reminder_date ? "Sudah terkirim" : undefined}>
        <input type="date" min={from && from > todayWib() ? from : todayWib()} value={remind} onChange={(e) => setRemind(e.target.value)} className={inputCls + " tnum"} />
      </FormRow>
      {remind && (
        <FormRow label="Pesan pengingat">
          <textarea rows={2} maxLength={255} value={remindMsg} onChange={(e) => setRemindMsg(e.target.value)} placeholder="Contoh: Baca sebelum akreditasi 30 Oktober." className={textareaCls} />
        </FormRow>
      )}
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} onClick={submit}>
          {folder ? "Simpan" : "Buat folder"}
        </Button>
      </div>
    </Modal>
  );
}

export function DeleteFolderModal({ folder, onClose, onDeleted }: { folder: FolderOut; onClose: () => void; onDeleted?: () => void }) {
  const toast = useToast();
  const refresh = useRefreshFiles();
  const m = useMutation({
    mutationFn: () => api(`/api/v1/admin/folders/${folder.id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast("Folder dihapus");
      onClose();
      onDeleted?.();
    },
    onError: (e) => (toast(errMsg(e)), onClose()),
  });
  return (
    <ConfirmModal
      title={`Hapus folder ${folder.name}?`}
      body={folder.file_count ? `${folder.file_count} file di dalamnya ikut terhapus permanen.` : "Folder akan dihapus dari daftar."}
      confirm="Hapus folder"
      danger
      loading={m.isPending}
      onConfirm={() => m.mutate()}
      onClose={onClose}
    />
  );
}
