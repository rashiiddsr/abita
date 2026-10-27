import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Camera, FolderOpen, ImageIcon, Info, LogOut, MessageCircle, Monitor, Moon, Sun, Trash2, UserCog } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "../lib/nav";
import { useHelpdesk } from "../components/helpdesk";
import { GradientHeader } from "../components/shell";
import { Avatar, Card, ConfirmSheet, cx, DangerButton, ListGroup, ListRow, SectionLabel, Sheet, useToast } from "../components/ui";
import { api, errMsg } from "../lib/api";
import { EMPLOYMENT, fmtMonth, isoMonth, todayWib } from "../lib/format";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../lib/push";
import { logout, useMe, useTheme, type ThemeMode } from "../lib/session";
import type { MonthSummary } from "../lib/types";
import { avatarUrl } from "./Home";

export function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const theme = useTheme();
  const help = useHelpdesk();
  const month = isoMonth(todayWib());
  const sum = useQuery({ queryKey: ["summary", month], queryFn: () => api<MonthSummary>("/me/summary", { query: { month } }) });
  const [photoSheet, setPhotoSheet] = useState(false);
  const [askLogout, setAskLogout] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  if (!me.data) return null;
  const u = me.data.user;
  const s = sum.data;

  const upload = async (f: File | undefined) => {
    setPhotoSheet(false);
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return toast("Ukuran foto maksimal 3 MB.", "bad");
    const fd = new FormData();
    fd.append("photo", f);
    try {
      await api("/me/avatar", { body: fd });
      localStorage.setItem("abita.avatarV", String(Date.now()));
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast("Foto profil diperbarui.");
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  };
  const remove = async () => {
    setPhotoSheet(false);
    try {
      await api("/me/avatar", { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  };

  return (
    <div>
      <GradientHeader deep className="pb-16">
        <div className="flex items-center gap-3.5 px-5 pt-4">
          <button type="button" onClick={() => setPhotoSheet(true)} aria-label="Ubah foto profil" className="relative rounded-full border-2 border-white/60 p-0.5">
            <Avatar name={u.name} src={avatarUrl(u)} size={64} onDark />
            <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full bg-card text-brand shadow-[var(--shadow-soft)]">
              <Camera size={13} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display line-clamp-2 text-[18px] font-bold">{u.name}</div>
            <div className="text-[13px] text-white/80">{u.employee_code}</div>
            {u.employment_type && <span className="mt-2 inline-block rounded-full bg-white/18 px-2.5 py-0.5 text-[12px] font-bold">{EMPLOYMENT[u.employment_type] ?? u.employment_type}</span>}
          </div>
        </div>
      </GradientHeader>
      <div className="relative z-10 -mt-10 px-4">
        <Card pad={false} className="grid grid-cols-3 divide-x divide-line py-3.5 shadow-[var(--shadow-card)]">
          <Stat v={s?.present} l="Hadir" />
          <Stat v={s?.late} l="Terlambat" />
          <Stat v={s ? s.izin + s.sakit : undefined} l="Izin/Sakit" />
        </Card>
        <p className="mt-1.5 pl-1 text-[11.5px] text-faint">Bulan {fmtMonth(month)}</p>
        <SectionLabel>Akun</SectionLabel>
        <ListGroup>
          <ListRow icon={<UserCog size={19} />} iconTone="brand" title="Pengaturan akun" subtitle="Data diri, kata sandi, data wajah" onClick={() => nav("/account")} />
          <ListRow icon={<FolderOpen size={19} />} iconTone="brand" title="Dokumen" onClick={() => nav("/documents")} />
          <PushRow />
        </ListGroup>
        <SectionLabel>Tentang</SectionLabel>
        <ListGroup>
          <ListRow icon={<MessageCircle size={19} />} iconTone="ok" title="Helpdesk" onClick={help.openHelp} />
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-[15px] font-semibold">Tema</span>
            <div className="flex gap-1 rounded-[12px] bg-soft p-1">
              {(
                [
                  ["system", <Monitor key="s" size={16} />, "Sistem"],
                  ["light", <Sun key="l" size={16} />, "Terang"],
                  ["dark", <Moon key="d" size={16} />, "Gelap"],
                ] as [ThemeMode, React.ReactNode, string][]
              ).map(([m, icon, label]) => (
                <button
                  key={m}
                  type="button"
                  aria-label={label}
                  onClick={() => theme.set(m)}
                  className={cx("flex h-8 w-10 items-center justify-center rounded-[9px]", theme.mode === m ? "bg-card text-brand shadow-[var(--shadow-soft)]" : "text-muted")}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <ListRow icon={<Info size={19} />} title="Versi aplikasi" trailing={<span className="font-semibold text-muted">1.0.0</span>} />
        </ListGroup>
        <DangerButton className="mt-5" icon={<LogOut size={18} />} onClick={() => setAskLogout(true)}>
          Keluar
        </DangerButton>
      </div>

      <Sheet open={photoSheet} onClose={() => setPhotoSheet(false)} title="Foto profil">
        <div className="-mx-5 divide-y divide-line">
          <ListRow icon={<Camera size={19} />} title="Ambil foto" onClick={() => camRef.current?.click()} />
          <ListRow icon={<ImageIcon size={19} />} title="Pilih dari galeri" onClick={() => galRef.current?.click()} />
          {u.has_avatar && <ListRow icon={<Trash2 size={19} />} title="Hapus foto" danger onClick={remove} />}
        </div>
      </Sheet>
      <input ref={camRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => upload(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      <ConfirmSheet
        open={askLogout}
        icon={<LogOut size={28} />}
        title="Keluar dari akun?"
        message="Anda perlu masuk lagi dengan email/NIK dan kata sandi."
        confirm="Keluar"
        danger
        onConfirm={logout}
        onClose={() => setAskLogout(false)}
      />
      {help.sheet}
    </div>
  );
}

const Stat = ({ v, l }: { v: number | undefined; l: string }) => (
  <div className="flex flex-col items-center">
    <span className="font-display text-[20px] font-bold">{v ?? "–"}</span>
    <span className="text-[12px] text-muted">{l}</span>
  </div>
);

/** Sakelar notifikasi push untuk perangkat ini. */
function PushRow() {
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void currentSubscription().then((s) => live && setOn(!!s && Notification.permission === "granted"));
    return () => {
      live = false;
    };
  }, []);
  if (!pushSupported()) return <ListRow icon={<Bell size={19} />} iconTone="muted" title="Notifikasi push" onClick={() => toast("Browser ini tidak mendukung notifikasi push.")} />;
  async function toggle() {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast("Notifikasi push dimatikan di perangkat ini.");
      } else {
        await enablePush();
        setOn(true);
        toast("Notifikasi push aktif di perangkat ini.");
      }
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ListRow
      icon={<Bell size={19} />}
      iconTone="purple"
      title="Notifikasi push"
      onClick={busy || on === null ? undefined : toggle}
      trailing={
        <span
          role="switch"
          aria-checked={!!on}
          aria-label="Notifikasi push"
          className={cx("relative h-7 w-12 flex-none rounded-full transition-colors", on ? "bg-brand" : "bg-line", busy && "opacity-60")}
        >
          <span className={cx("absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left]", on ? "left-[22px]" : "left-0.5")} />
        </span>
      }
    />
  );
}
