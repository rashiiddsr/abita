/** Notifikasi: dikelompokkan per tanggal, filter kategori, ketuk untuk membuka detail. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, CheckCheck, ChevronRight, FileText, FolderOpen, Info, Repeat2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { SubPage } from "../components/shell";
import { Card, cx, Empty, FilterPill, Skel, useToast } from "../components/ui";
import { api, errMsg } from "../lib/api";
import { fmtDateMed, fmtTime, todayWib, addDays } from "../lib/format";
import { useNavigate } from "../lib/nav";
import type { Notification } from "../lib/types";

export const KIND: Record<string, { label: string; icon: React.ReactNode; tone: "brand" | "warn" | "purple" | "bad" | "muted" | "ok" }> = {
  leave: { label: "Pengajuan", icon: <FileText size={18} />, tone: "purple" },
  swap: { label: "Tukar shift", icon: <Repeat2 size={18} />, tone: "warn" },
  shift: { label: "Jadwal", icon: <CalendarClock size={18} />, tone: "brand" },
  schedule: { label: "Jadwal", icon: <CalendarClock size={18} />, tone: "ok" },
  attendance: { label: "Presensi", icon: <ShieldAlert size={18} />, tone: "bad" },
  document: { label: "Dokumen", icon: <FolderOpen size={18} />, tone: "brand" },
  system: { label: "Akun", icon: <Info size={18} />, tone: "muted" },
};
export const kindOf = (k: string) => KIND[k] ?? { label: "Info", icon: <Bell size={18} />, tone: "muted" as const };

type Filter = "semua" | "pengajuan" | "jadwal" | "presensi" | "dokumen" | "lainnya";
const FILTERS: { value: Filter; label: string; kinds?: string[] }[] = [
  { value: "semua", label: "Semua" },
  { value: "pengajuan", label: "Pengajuan", kinds: ["leave", "swap"] },
  { value: "jadwal", label: "Jadwal", kinds: ["shift", "schedule"] },
  { value: "presensi", label: "Presensi", kinds: ["attendance"] },
  { value: "dokumen", label: "Dokumen", kinds: ["document"] },
  { value: "lainnya", label: "Lainnya" },
];
const KNOWN = new Set(["leave", "swap", "shift", "schedule", "attendance", "document"]);

/** Tanggal WIB "YYYY-MM-DD" dari waktu ISO. */
const wibDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);

export function NotificationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("semua");
  const list = useQuery({ queryKey: ["notifs"], queryFn: () => api<Notification[]>("/me/notifications", { query: { limit: 100 } }) });
  const all = list.data ?? [];
  const unread = all.filter((n) => !n.read_at).length;
  const f = FILTERS.find((x) => x.value === filter)!;
  const shown = all.filter((n) => (f.kinds ? f.kinds.includes(n.kind) : filter === "lainnya" ? !KNOWN.has(n.kind) : true));
  const today = todayWib();
  const groups = new Map<string, Notification[]>();
  for (const n of shown) groups.set(wibDay(n.created_at), [...(groups.get(wibDay(n.created_at)) ?? []), n]);
  const dayLabel = (d: string) => (d === today ? "Hari ini" : d === addDays(today, -1) ? "Kemarin" : fmtDateMed(d));

  const readAll = async () => {
    try {
      await api("/me/notifications/read-all", { method: "POST" });
      qc.invalidateQueries({ queryKey: ["notifs"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(errMsg(e));
    }
  };

  return (
    <SubPage
      title="Notifikasi"
      back="/dashboard" // keluar ke beranda (bukan riwayat: detail -> daftar -> detail berputar)
      action={
        unread > 0 && (
          <button type="button" onClick={readAll} className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold text-brand active:bg-soft">
            <CheckCheck size={17} /> Tandai dibaca
          </button>
        )
      }
    >
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-1">
        {FILTERS.map((x) => (
          <FilterPill key={x.value} selected={filter === x.value} onClick={() => setFilter(x.value)}>
            {x.label}
          </FilterPill>
        ))}
      </div>
      {list.isPending ? (
        <Skel className="mt-3 h-60" />
      ) : !shown.length ? (
        <Card className="mt-3">
          <Empty title="Belum Ada Notifikasi" />
        </Card>
      ) : (
        [...groups].map(([day, items]) => (
          <section key={day}>
            <h2 className="px-1 pb-2 pt-4 text-[13px] font-bold text-ink">{dayLabel(day)}</h2>
            <div className="flex flex-col gap-2.5">
              {items.map((n) => (
                <Card key={n.id} onClick={() => nav(`/notifications/${n.id}`)} className="flex items-center gap-3 active:bg-soft">
                  <span className={cx("mt-1.5 size-2 shrink-0 self-start rounded-full", n.read_at ? "bg-transparent" : "bg-bad")} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cx("line-clamp-2 text-[14.5px] leading-snug", n.read_at ? "font-semibold text-ink/80" : "font-bold text-ink")}>{n.title}</span>
                    <span className="text-[12px] text-faint">
                      {kindOf(n.kind).label} · {fmtTime(n.created_at)}
                    </span>
                  </span>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <ChevronRight size={17} />
                  </span>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </SubPage>
  );
}
