/** Menu aplikasi: satu daftar fitur untuk ikon beranda dan halaman Semua menu. */
import { Bell, ChartPie, ClipboardList, FileText, FolderOpen, History, LayoutGrid, MessageCircle, Repeat2, ScanFace, Thermometer, UserCog } from "lucide-react";
import { useState, type ReactNode } from "react";
import { attendanceGate } from "../lib/attendance-gate";
import { useNavigate } from "../lib/nav";
import { useMe } from "../lib/session";
import { LeaveForm, SwapForm } from "./forms";
import { useHelpdesk } from "./helpdesk";
import { RecapSheet } from "./recap";
import { IconTile, useToast } from "./ui";

type Tone = "ok" | "warn" | "bad" | "brand" | "muted" | "purple";
type Sheet = "izin" | "sakit" | "tukar" | "rekap";
export type AppId = "presensi" | "riwayat" | "rekap" | "izin" | "sakit" | "tukar" | "pengajuan" | "dokumen" | "notifikasi" | "helpdesk" | "akun";

type App = { id: AppId; label: string; icon: ReactNode; tone: Tone; to?: string; sheet?: Sheet };

export const APPS: Record<AppId, App> = {
  presensi: { id: "presensi", label: "Presensi", icon: <ScanFace size={22} />, tone: "brand", to: "/attendance" },
  riwayat: { id: "riwayat", label: "Riwayat", icon: <History size={22} />, tone: "muted", to: "/shift" },
  rekap: { id: "rekap", label: "Rekap", icon: <ChartPie size={22} />, tone: "ok", sheet: "rekap" },
  izin: { id: "izin", label: "Izin", icon: <FileText size={22} />, tone: "purple", sheet: "izin" },
  sakit: { id: "sakit", label: "Sakit", icon: <Thermometer size={22} />, tone: "bad", sheet: "sakit" },
  tukar: { id: "tukar", label: "Tukar shift", icon: <Repeat2 size={22} />, tone: "warn", sheet: "tukar" },
  pengajuan: { id: "pengajuan", label: "Pengajuan", icon: <ClipboardList size={22} />, tone: "brand", to: "/requests" },
  dokumen: { id: "dokumen", label: "Dokumen", icon: <FolderOpen size={22} />, tone: "brand", to: "/documents" },
  notifikasi: { id: "notifikasi", label: "Notifikasi", icon: <Bell size={22} />, tone: "purple", to: "/notifications" },
  helpdesk: { id: "helpdesk", label: "Helpdesk", icon: <MessageCircle size={22} />, tone: "ok" },
  akun: { id: "akun", label: "Akun", icon: <UserCog size={22} />, tone: "muted", to: "/account" },
};

/** Ikon di beranda (maks. 7 + Semua). */
export const HOME_APPS: AppId[] = ["izin", "sakit", "tukar", "riwayat", "dokumen", "rekap", "notifikasi"];

export const APP_GROUPS: { title: string; apps: AppId[] }[] = [
  { title: "Presensi", apps: ["presensi", "riwayat", "rekap"] },
  { title: "Pengajuan", apps: ["izin", "sakit", "tukar", "pengajuan"] },
  { title: "Lainnya", apps: ["dokumen", "notifikasi", "helpdesk", "akun"] },
];

/** Membuka fitur: pindah halaman atau membuka lembar formulir. Render `sheets` sekali di halaman pemakai. */
export function useApps() {
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const help = useHelpdesk();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const sent = (msg: string) => {
    setSheet(null);
    toast(msg);
  };
  const open = (id: AppId) => {
    const a = APPS[id];
    if (id === "helpdesk") return help.openHelp();
    if (id === "presensi") {
      const g = attendanceGate(me.data?.today);
      if (me.data && !g.can) return toast(g.hint ?? "Tidak bisa absen sekarang.");
    }
    if (a.sheet) return setSheet(a.sheet);
    if (a.to) nav(a.to);
  };
  const close = () => setSheet(null);
  const sheets = (
    <>
      <LeaveForm kind="izin" open={sheet === "izin"} onClose={close} onSent={() => sent("Pengajuan izin terkirim.")} />
      <LeaveForm kind="sakit" open={sheet === "sakit"} onClose={close} onSent={() => sent("Pengajuan sakit terkirim.")} />
      <SwapForm open={sheet === "tukar"} onClose={close} onSent={() => sent("Pengajuan tukar shift terkirim.")} />
      <RecapSheet open={sheet === "rekap"} onClose={close} />
      {help.sheet}
    </>
  );
  return { open, sheets };
}

export function AppTile({ icon, tone, label, onClick }: { icon: ReactNode; tone: Tone; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-w-0 flex-col items-center gap-2 rounded-[16px] py-1.5 active:bg-soft">
      <IconTile icon={icon} tone={tone} size={52} />
      <span className="w-full truncate text-center text-[12.5px] font-semibold">{label}</span>
    </button>
  );
}

/** Kisi 4 kolom; `more` menambah tile "Semua" yang membuka halaman Semua menu. */
export function AppGrid({ ids, onOpen, more }: { ids: AppId[]; onOpen: (id: AppId) => void; more?: () => void }) {
  return (
    <div className="grid grid-cols-4 gap-y-3">
      {ids.map((id) => (
        <AppTile key={id} icon={APPS[id].icon} tone={APPS[id].tone} label={APPS[id].label} onClick={() => onOpen(id)} />
      ))}
      {more && <AppTile icon={<LayoutGrid size={22} />} tone="muted" label="Semua" onClick={more} />}
    </div>
  );
}
