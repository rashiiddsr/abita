import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Calendar,
  CalendarDays,
  ChartColumn,
  ChevronRight,
  House,
  FolderOpen,
  ChevronDown,
  ClipboardCheck,
  FileText,
  LayoutGrid,
  LogOut,
  Building2,
  ShieldCheck,
  Menu,
  Settings,
  UserRound,
  Users,
  X,
  Check,
  Monitor,
  Moon,
  Palette,
  Sun,
} from "lucide-react";
import { Link, usePathname, useRouter } from "@/lib/nav";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { menuOf, type MenuKey } from "@/lib/access";
import { api } from "@/lib/api";
import { fmtAgo, fmtDateLong, todayWib } from "@/lib/format";
import { SessionProvider, useMounted, useSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/status";
import { setTheme, useTheme } from "@/lib/theme";
import type { AppNotification, Me } from "@/lib/types";
import { LogoMark, Wordmark } from "./brand";
import { GlobalSearch } from "./global-search";
import { Avatar, Spinner, cx, Empty } from "./ui";
import { useRealtime } from "@/lib/realtime";

type NavItem = { href: string; label: string; icon: typeof LayoutGrid; menu: MenuKey; badge?: boolean };

const NAV_MAIN: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, menu: "dashboard" },
  { href: "/attendance", label: "Absensi", icon: ClipboardCheck, menu: "absensi" },
  { href: "/requests", label: "Pengajuan", icon: FileText, menu: "pengajuan", badge: true },
  { href: "/staff", label: "Karyawan", icon: Users, menu: "karyawan" },
  { href: "/schedule", label: "Jadwal / Shift", icon: CalendarDays, menu: "jadwal" },
  { href: "/reports", label: "Laporan", icon: ChartColumn, menu: "laporan" },
  { href: "/documents", label: "Dokumen", icon: FolderOpen, menu: "dokumen" },
];
const NAV_ADMIN: NavItem[] = [
  { href: "/units", label: "Kelola Unit", icon: Building2, menu: "kelolaUnit" },
  { href: "/admins", label: "Kelola Admin", icon: ShieldCheck, menu: "kelolaAdmin" },
  { href: "/settings", label: "Pengaturan", icon: Settings, menu: "pengaturan" },
  { href: "/profile", label: "Profil", icon: UserRound, menu: "profil" },
];
const NAV = [...NAV_MAIN, ...NAV_ADMIN];

function active(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

// ------------------------------------------------------------------ status sidebar (lebar / ringkas)
// "auto" = belum pernah diubah: ringkas di 768–1279px, lebar di ≥1280px. Disimpan per browser.

type SideMode = "auto" | "full" | "mini";
const SIDE_KEY = "presensi.sidebar";
const SIDE_EVENT = "presensi-sidebar";

function subscribeSide(cb: () => void) {
  window.addEventListener(SIDE_EVENT, cb);
  return () => window.removeEventListener(SIDE_EVENT, cb);
}
function readSide(): SideMode {
  try {
    const v = localStorage.getItem(SIDE_KEY);
    return v === "full" || v === "mini" ? v : "auto";
  } catch {
    return "auto";
  }
}
function setSide(v: SideMode) {
  try {
    localStorage.setItem(SIDE_KEY, v);
  } catch {}
  window.dispatchEvent(new Event(SIDE_EVENT));
}

/** Kelas untuk elemen yang hanya tampil saat sidebar lebar. */
const wide = (m: SideMode) => (m === "full" ? "block" : m === "mini" ? "hidden" : "hidden xl:block");

// ------------------------------------------------------------------ kerangka

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/v1/me"), staleTime: 60_000, refetchInterval: 60_000 });

  const mustChange = !!me.data?.user.must_change_password;
  useEffect(() => {
    if (me.data && me.data.user.role === "staff")
      window.location.replace("/staff"); // akun staff memakai aplikasi karyawan
    else if (mustChange) router.replace("/change-password"); // kata sandi dari admin/email harus diganti dulu
  }, [me.data, mustChange, router]);

  if (!me.data || mustChange) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        {me.isError ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <LogoMark size={56} />
            <span className="mt-1 text-lg font-semibold">Tidak bisa memuat akun</span>
            <span className="max-w-sm text-sm text-muted">{(me.error as Error).message}</span>
            <button onClick={() => me.refetch()} className="bg-cta h-10 rounded-lg px-5 text-sm font-medium text-white">
              Coba lagi
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <LogoMark size={56} />
            <Spinner size={22} />
          </div>
        )}
      </div>
    );
  }
  return (
    <SessionProvider me={me.data}>
      <Frame>{children}</Frame>
    </SessionProvider>
  );
}

function usePending() {
  const s = useSession();
  // jumlah pengajuan yang menunggu keputusan penampil (badge menu Pengajuan)
  const q = useQuery({
    queryKey: ["pending-count", s.me.user.id],
    queryFn: async () => {
      const [lv, sw] = await Promise.all([
        api<{ can_review: boolean }[]>("/api/v1/admin/leaves", { query: { status: "pending" } }),
        api<{ can_review: boolean }[]>("/api/v1/admin/swaps", { query: { status: "pending" } }),
      ]);
      return lv.filter((x) => x.can_review).length + sw.filter((x) => x.can_review).length;
    },
    refetchInterval: 60_000,
    enabled: s.can.review,
  });
  return q.data ?? 0;
}

function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    qc.clear();
    router.replace("/login");
  };
}

/** Halaman di luar hak akses peran dialihkan ke Dashboard (backend tetap menolak dengan 403). */
function RouteGuard({ path, children }: { path: string; children: ReactNode }) {
  const s = useSession();
  const router = useRouter();
  const allowed = s.can.menus.has(menuOf(path));
  useEffect(() => {
    if (!allowed) router.replace("/dashboard");
  }, [allowed, router]);
  if (!allowed)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  return children;
}

// ------------------------------------------------------------------ breadcrumb

const CrumbCtx = createContext<(label: string | null) => void>(() => undefined);

/** Label crumb terakhir halaman detail (mis. nama karyawan); default "Detail". */
export function useCrumb(label: string | null | undefined) {
  const set = useContext(CrumbCtx);
  useEffect(() => {
    set(label ?? null);
    return () => set(null);
  }, [label, set]);
}

/** Sub-halaman yang punya nama sendiri (bukan id). */
const SUB: Record<string, string> = { swap: "Tukar shift" };

function Breadcrumb({ path, last }: { path: string; last: string | null }) {
  const segs = path.split("/").filter(Boolean);
  const top = NAV.find((n) => active(path, n.href));
  if (!top) return null;
  const crumbs: { label: string; href?: string }[] = [{ label: top.label, href: segs.length > 1 ? top.href : undefined }];
  for (let i = 1; i < segs.length; i++) {
    const end = i === segs.length - 1;
    if (SUB[segs[i]] && !end) crumbs.push({ label: SUB[segs[i]] });
    else if (end) crumbs.push({ label: last ?? "Detail" });
  }
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 px-4 pb-3 pt-1 text-[13px] md:px-6 xl:px-8">
      <Link href="/dashboard" aria-label="Dashboard" className="flex flex-none text-muted hover:text-ink">
        <House size={14} />
      </Link>
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          <ChevronRight size={14} className="flex-none text-faint" />
          {c.href ? (
            <Link href={c.href} className="flex-none text-muted hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className={cx("truncate", i === crumbs.length - 1 ? "font-medium text-ink" : "text-muted")} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [crumb, setCrumb] = useState<string | null>(null);
  const pending = usePending();
  useRealtime(useSession().me.user.id);
  const title = NAV.find((n) => active(path, n.href))?.label ?? "Dashboard";
  const mode = useSyncExternalStore(subscribeSide, readSide, () => "auto" as SideMode);
  const [drawer, setDrawer] = useState(false);
  const logout = useLogout();

  // hamburger: di ≥768px mengubah lebar sidebar, di layar kecil membuka sidebar sebagai laci
  function toggle() {
    if (!window.matchMedia("(min-width: 768px)").matches) return setDrawer(true);
    const isWide = mode === "full" || (mode === "auto" && window.matchMedia("(min-width: 1280px)").matches);
    setSide(isWide ? "mini" : "full");
  }

  return (
    <div className="flex min-h-screen items-stretch">
      <aside
        className={cx(
          "sticky top-0 hidden h-screen flex-none flex-col gap-5 border-r border-sidebar-line bg-sidebar py-5 text-white transition-[width] duration-200 md:flex",
          mode === "full" ? "w-[248px] px-4" : mode === "mini" ? "w-[76px] px-3" : "w-[76px] px-3 xl:w-[248px] xl:px-4",
        )}
      >
        <SidebarBody mode={mode} pending={pending} path={path} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-[rgba(13,23,38,.42)]" onClick={() => setDrawer(false)} />
          <aside className="animate-rise absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col gap-5 border-r border-sidebar-line bg-sidebar px-4 py-5 text-white">
            <button onClick={() => setDrawer(false)} aria-label="Tutup menu" className="absolute right-3 top-5 flex size-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10">
              <X size={18} />
            </button>
            <SidebarBody mode="full" pending={pending} path={path} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 flex-none items-center gap-3 bg-bg/90 px-4 backdrop-blur md:px-6 xl:px-8">
          <button
            onClick={toggle}
            aria-label="Buka/tutup menu"
            title="Buka/tutup menu"
            className="flex size-[42px] flex-none items-center justify-center rounded-full bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line)] active:scale-95"
          >
            <Menu size={19} />
          </button>
          <span className="min-w-0 truncate text-xl font-semibold md:w-[180px] md:flex-none">{title}</span>
          <div className="flex min-w-0 flex-1 justify-end md:justify-center">
            <GlobalSearch />
          </div>
          <TodayChip />
          <NotifBell />
          <ProfileMenu onLogout={logout} />
        </header>
        <Breadcrumb path={path} last={crumb} />
        <div className="flex-1">
          <CrumbCtx.Provider value={setCrumb}>
            <RouteGuard path={path}>{children}</RouteGuard>
          </CrumbCtx.Provider>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ isi sidebar

function SidebarBody({ mode, pending, path, onNavigate }: { mode: SideMode; pending: number; path: string; onNavigate?: () => void }) {
  const s = useSession();
  const main = NAV_MAIN.filter((n) => s.can.menus.has(n.menu));
  const admin = NAV_ADMIN.filter((n) => s.can.menus.has(n.menu));
  const link = (n: NavItem) => {
    const on = active(path, n.href);
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        title={n.label}
        onClick={onNavigate}
        className={cx(
          "relative flex h-10 items-center gap-3 rounded-lg text-[14px] font-medium transition-colors",
          mode === "full" ? "justify-start px-3" : mode === "mini" ? "justify-center" : "justify-center xl:justify-start xl:px-3",
          on ? "bg-white/[.14] text-white" : "text-white/70 hover:bg-white/[.07] hover:text-white",
        )}
      >
        <Icon size={18} strokeWidth={1.9} />
        <span className={cx("flex-1 text-left", wide(mode))}>{n.label}</span>
        {n.badge && pending > 0 && (
          <span
            className={cx(
              "tnum flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad px-1 text-[11px] font-medium text-white",
              mode === "full" ? "static" : mode === "mini" ? "absolute right-1.5 top-0.5" : "absolute right-1.5 top-0.5 xl:static",
            )}
          >
            {pending}
          </span>
        )}
      </Link>
    );
  };
  return (
    <>
      <div className={cx("flex items-center gap-2.5 border-b border-white/10 px-1 pb-5", mode === "full" ? "justify-start" : mode === "mini" ? "justify-center" : "justify-center xl:justify-start")}>
        <LogoMark size={34} radius={9} variant="white" />
        <span className={cx("min-w-0 flex-col leading-tight", mode === "full" ? "flex" : mode === "mini" ? "hidden" : "hidden xl:flex")}>
          <Wordmark onDark className="text-[16px] font-bold" />
          <span className="truncate text-[11px] text-white/55">RS Awal Bros Botania</span>
        </span>
      </div>
      <UnitScope mode={mode} />
      <nav className="flex flex-col gap-1">{main.map(link)}</nav>
      <nav className="flex flex-col gap-1">
        <span className={cx("px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-white/40", wide(mode))}>{admin.length > 1 ? "Administrasi" : "Akun"}</span>
        <span className={cx("mx-2 mb-1 h-px bg-white/10", mode === "full" ? "hidden" : mode === "mini" ? "block" : "block xl:hidden")} />
        {admin.map(link)}
      </nav>
    </>
  );
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

/**
 * Pilihan unit di bawah nama aplikasi: Admin SDM memfilter semua unit; Kepala Unit yang memimpin beberapa unit berpindah unit kerja.
 * Kepala Unit 1 unit tidak punya pilihan (data selalu unitnya).
 */
function UnitScope({ mode }: { mode: SideMode }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const head = s.isHead && s.headUnits.length > 1;
  if (!s.can.unitFilter && !head) return null;
  const label = s.scope === "all" ? "Semua unit" : s.scope;
  const field = cx(
    "flex h-9 w-full items-center gap-2 rounded-lg border border-white/20 bg-transparent text-left text-[13px] text-white transition-colors",
    mode === "full" ? "px-2.5" : mode === "mini" ? "justify-center" : "justify-center xl:justify-start xl:px-2.5",
  );
  const caption = <span className={cx("px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/40", wide(mode))}>Unit</span>;
  const total = s.units.reduce((a, u) => a + u.staff_count, 0);
  const byName = new Map(s.units.map((u) => [u.name, u.staff_count]));
  // Kepala Unit beberapa unit: "Semua unit" = semua unitnya
  const opts = head
    ? [{ k: "all", label: "Semua unit", count: s.headUnits.reduce((a, n) => a + (byName.get(n) ?? 0), 0) }, ...s.headUnits.map((n) => ({ k: n, label: n, count: byName.get(n) ?? 0 }))]
    : [{ k: "all", label: "Semua unit", count: total }, ...s.units.map((u) => ({ k: u.name, label: u.name, count: u.staff_count }))];
  return (
    <div ref={ref} className="relative flex flex-col">
      {caption}
      <button onClick={() => setOpen(!open)} title={`Unit: ${label}`} className={cx(field, open ? "border-white/50" : "hover:border-white/40")}>
        <Building2 size={15} strokeWidth={1.9} className="flex-none text-white/70" />
        <span className={cx("min-w-0 flex-1 truncate", wide(mode))}>{label}</span>
        <ChevronDown size={15} className={cx("flex-none text-white/60", wide(mode))} />
      </button>
      {open && (
        <div
          className={cx(
            "absolute z-40 flex max-h-[70vh] w-[260px] flex-col overflow-y-auto rounded-xl bg-card p-1.5 text-ink shadow-pop",
            mode === "full" ? "left-0 top-[62px]" : mode === "mini" ? "left-[52px] top-0" : "left-[52px] top-0 xl:left-0 xl:top-[62px]",
          )}
        >
          {opts.map((o) => (
            <button
              key={o.k}
              onClick={() => {
                s.setScope(o.k);
                setOpen(false);
              }}
              className={cx("flex h-9 flex-none items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-soft", s.scope === o.k ? "font-medium text-ink" : "text-muted")}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Check size={14} className={cx("flex-none text-brand", s.scope !== o.k && "invisible")} />
                <span className="truncate">{o.label}</span>
              </span>
              <span className="tnum text-xs text-faint">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ navbar kanan

function TodayChip() {
  const today = useMounted(() => todayWib());
  if (!today) return null;
  return (
    <span className="hidden h-[42px] flex-none items-center gap-2 whitespace-nowrap rounded-lg bg-card px-3.5 text-[13px] font-medium shadow-[inset_0_0_0_1px_var(--color-line)] 2xl:flex">
      <Calendar size={16} strokeWidth={2.2} className="text-muted" />
      {fmtDateLong(today)}
    </span>
  );
}

function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const s = useSession();
  const router = useRouter();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const u = s.me.user;
  return (
    <div ref={ref} className="relative flex-none">
      <button onClick={() => setOpen(!open)} aria-label="Menu akun" className="flex h-[42px] items-center gap-2.5 rounded-full bg-card p-1 shadow-[inset_0_0_0_1px_var(--color-line)] lg:pr-3">
        <Avatar name={u.name} size={30} bg="#004650" fg="#FFFFFF" userId={u.id} photo={u.has_avatar} />
        <span className="hidden min-w-0 flex-col text-left leading-tight lg:flex">
          <span className="max-w-[150px] truncate text-[13px] font-medium">{u.name}</span>
          <span className="max-w-[150px] truncate text-[11.5px] text-muted">
            {ROLE_LABEL[u.role]}
            {s.isHead && u.unit ? ` · ${u.unit}` : ""}
          </span>
        </span>
        <ChevronDown size={16} className="hidden text-muted lg:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-[50px] z-30 flex w-[240px] flex-col rounded-xl bg-card p-1.5 shadow-pop">
          <button
            onClick={() => {
              setOpen(false);
              router.push("/profile");
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-soft"
          >
            <UserRound size={16} className="text-muted" /> Profil
          </button>
          <div className="flex flex-col gap-1.5 px-2.5 py-2">
            <span className="flex items-center gap-2.5 text-[13px]">
              <Palette size={16} className="text-muted" /> Tema
            </span>
            <div className="grid grid-cols-3 rounded-lg bg-soft p-0.5">
              {(
                [
                  ["system", "Sistem", Monitor],
                  ["light", "Terang", Sun],
                  ["dark", "Gelap", Moon],
                ] as const
              ).map(([k, l, I]) => (
                <button
                  key={k}
                  onClick={() => setTheme(k)}
                  className={cx(
                    "flex h-7 items-center justify-center gap-1 rounded-md text-xs font-medium",
                    theme === k ? "bg-raised text-ink shadow-[0_1px_2px_rgba(16,24,40,.12)]" : "text-muted hover:text-ink",
                  )}
                >
                  <I size={13} />
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-0.5 border-t border-line pt-1">
            <button onClick={onLogout} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-bad hover:bg-bad-bg">
              <LogOut size={16} /> Keluar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tujuan notifikasi: tautan spesifik bila ada, selain itu menurut jenis; hanya bila peran punya akses. */
// tautan notifikasi yang tersimpan sebelum URL berbahasa Inggris (masih ada di database) -> path baru
const LEGACY_SEGMENTS: Record<string, string> = {
  absensi: "attendance",
  jadwal: "schedule",
  karyawan: "staff",
  "kelola-admin": "admins",
  "kelola-unit": "units",
  laporan: "reports",
  pengajuan: "requests",
  tukar: "swap",
  pengaturan: "settings",
  profil: "profile",
};
const modernLink = (link: string) =>
  link.replace(/^\/[^?#]*/, (p) =>
    p
      .split("/")
      .map((seg) => LEGACY_SEGMENTS[seg] ?? seg)
      .join("/"),
  );

function notifHref(kind: string, raw: string | null, has: (m: MenuKey) => boolean): string | null {
  const link = raw ? modernLink(raw) : null;
  if (link && has(menuOf(link.split("?")[0]))) return link;
  if ((kind === "leave" || kind === "swap") && has("pengajuan")) return "/requests";
  if ((kind === "schedule" || kind === "shift") && has("jadwal")) return "/schedule";
  if (kind === "attendance" && has("absensi")) return "/attendance";
  if (kind === "system" && has("pengaturan")) return "/settings";
  return null;
}

/** Notifikasi per peran; Kepala Unit memilih jenisnya di Pengaturan › Notifikasi. */
function NotifBell() {
  const s = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const unread = s.me.unread_notifications;
  const list = useQuery({ queryKey: ["notifs", unread], queryFn: () => api<AppNotification[]>("/api/v1/me/notifications"), enabled: open });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["notifs"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  async function readAll() {
    await api("/api/v1/me/notifications/read-all", { method: "POST" });
    refresh();
  }
  async function openOne(n: AppNotification, href: string | null) {
    if (!n.read_at) api(`/api/v1/me/notifications/${n.id}/read`, { method: "POST" }).then(refresh, () => null);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }
  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        aria-label={unread ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"}
        className="relative flex size-[42px] flex-none items-center justify-center rounded-full bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line)] active:scale-95"
      >
        <Bell size={19} strokeWidth={2} />
        {unread > 0 && (
          <span className="tnum absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-bg bg-bad px-1 text-[10.5px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-[50px] z-30 flex max-h-[70vh] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl bg-card shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[14px] font-semibold">Notifikasi{unread > 0 && <span className="tnum ml-1.5 font-normal text-muted">{unread} baru</span>}</span>
            {unread > 0 && (
              <button onClick={readAll} className="text-[12.5px] font-medium text-brand hover:underline">
                Tandai semua dibaca
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-1.5">
            {list.isLoading && (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
            {list.data?.length === 0 && <Empty compact />}
            {list.data?.slice(0, 30).map((n) => {
              const href = notifHref(n.kind, n.link, (m) => s.can.menus.has(m));
              return (
                <button
                  key={n.id}
                  onClick={() => openOne(n, href)}
                  className={cx("flex w-full gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors", href || !n.read_at ? "hover:bg-hover" : "cursor-default")}
                >
                  <span className={cx("mt-1.5 size-2 flex-none rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={cx("text-[13px]", n.read_at ? "text-muted" : "font-medium text-ink")}>{n.title}</span>
                    {n.body && <span className="text-[12.5px] leading-snug text-muted">{n.body}</span>}
                    <span className="text-[11.5px] text-faint">{fmtAgo(n.created_at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Kerangka halaman: lebar mengikuti layar (padding desain). */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cx("flex w-full flex-col gap-[18px] px-4 pb-8 pt-2 md:px-6 xl:px-8", className)}>{children}</main>;
}
