import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import type { User } from "@/lib/types";
import { useToast } from "./providers";
import { ResetPasswordFlow } from "./credentials";
import { ConfirmModal, StaffFormModal } from "./staff-form";

export type StaffAction = "edit" | "password" | "face" | "toggle";

/** Menjalankan aksi Admin SDM terhadap akun karyawan (dipakai daftar & detail). */
export function useStaffActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const [act, setAct] = useState<{ user: User; kind: StaffAction } | null>(null);
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["staff"] });
    qc.invalidateQueries({ queryKey: ["staff-detail"] });
    qc.invalidateQueries({ queryKey: ["users"] });
    toast(msg);
    setAct(null);
  };
  const face = useMutation({
    mutationFn: (u: User) => api(`/api/v1/admin/users/${u.id}/reset-face`, { method: "POST" }),
    onSuccess: (_d, u) => done(`Data wajah ${u.name.split(" ")[0]} direset · perlu daftar ulang`),
    onError: (e) => toast(errMsg(e)),
  });
  const toggle = useMutation({
    mutationFn: (u: User) => api(`/api/v1/admin/users/${u.id}`, { method: "PUT", body: { is_active: u.is_active === false } }),
    onSuccess: (_d, u) => done(u.is_active === false ? `${u.name.split(" ")[0]} diaktifkan kembali` : `${u.name.split(" ")[0]} dinonaktifkan`),
    onError: (e) => toast(errMsg(e)),
  });

  const modal = !act ? null : act.kind === "edit" ? (
    <StaffFormModal user={act.user} onClose={() => setAct(null)} />
  ) : act.kind === "password" ? (
    <ResetPasswordFlow user={act.user} onClose={() => setAct(null)} />
  ) : act.kind === "face" ? (
    <ConfirmModal
      title="Reset data wajah?"
      body={`${act.user.name} harus mendaftarkan wajah ulang di aplikasi sebelum bisa presensi lagi.`}
      confirm="Reset wajah"
      danger
      loading={face.isPending}
      onConfirm={() => face.mutate(act.user)}
      onClose={() => setAct(null)}
    />
  ) : (
    <ConfirmModal
      title={act.user.is_active === false ? "Aktifkan kembali?" : "Nonaktifkan karyawan?"}
      body={
        act.user.is_active === false
          ? `${act.user.name} bisa masuk dan presensi lagi.`
          : `${act.user.name} tidak bisa masuk, presensi, dan tidak tampil di jadwal. Data lama tetap tersimpan.`
      }
      confirm={act.user.is_active === false ? "Aktifkan" : "Nonaktifkan"}
      danger={act.user.is_active !== false}
      loading={toggle.isPending}
      onConfirm={() => toggle.mutate(act.user)}
      onClose={() => setAct(null)}
    />
  );
  return { open: (user: User, kind: StaffAction) => setAct({ user, kind }), modal };
}
