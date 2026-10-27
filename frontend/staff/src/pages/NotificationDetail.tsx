/** Detail notifikasi: kategori, waktu, judul, isi lengkap, dan pintasan ke halaman terkait. Dibuka = ditandai dibaca. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { SubPage } from "../components/shell";
import { Card, Empty, Pill, PrimaryButton, Skel } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useNavigate } from "../lib/nav";
import type { Notification } from "../lib/types";
import { kindOf } from "./Notifications";

/** Halaman karyawan yang terkait jenis notifikasi. */
const TARGET: Record<string, [string, string]> = {
  leave: ["/requests", "Lihat pengajuan"],
  swap: ["/requests", "Lihat pengajuan"],
  shift: ["/shift", "Lihat jadwal"],
  schedule: ["/shift", "Lihat jadwal"],
  attendance: ["/shift", "Lihat riwayat"],
};

export function NotificationDetailPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["notif", id], queryFn: () => api<Notification>(`/me/notifications/${id}`), retry: false });
  // server menandai dibaca saat detail dimuat: perbarui daftar & lonceng
  useEffect(() => {
    if (!q.data) return;
    qc.invalidateQueries({ queryKey: ["notifs"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  }, [q.data, qc]);
  const n = q.data;
  const k = n ? kindOf(n.kind) : null;
  const target: [string, string] | undefined = n?.kind === "document" ? [n.link ?? "/documents", "Buka dokumen"] : n ? TARGET[n.kind] : undefined;
  return (
    <SubPage title="Notifikasi">
      {q.isPending ? (
        <Skel className="mt-2 h-48" />
      ) : !n || !k ? (
        <Card className="mt-2">
          <Empty title="Notifikasi tidak ditemukan" />
        </Card>
      ) : (
        <Card className="mt-2">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Pill tone={k.tone}>{k.label}</Pill>
            <span className="tnum flex-1 text-right text-[13px] text-muted">{fmtDateTime(n.created_at)}</span>
          </div>
          <h1 className="font-display mt-3.5 text-[18px] font-bold leading-snug">{n.title}</h1>
          {n.body && <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-muted">{n.body}</p>}
          {target && (
            <PrimaryButton className="mt-5" onClick={() => nav(target[0])}>
              {target[1]}
            </PrimaryButton>
          )}
        </Card>
      )}
    </SubPage>
  );
}
