/** Kerangka aplikasi: bingkai HP (maks. 480px), header gradien, bar navigasi bawah dengan tombol Presensi di tengah. */
import { CalendarDays, ChevronLeft, ClipboardList, House, ScanFace, User } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "../lib/nav";
import { cx } from "./ui";

/** Bingkai aplikasi: di HP penuh layar, di desktop tampil seperti layar HP di tengah. */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#dfe7f1] dark:bg-black sm:py-0">
      <div className="relative mx-auto min-h-dvh w-full max-w-[480px] bg-bg shadow-[0_0_60px_rgba(15,23,42,.12)]">
        {children}
        {/* iPhone (status bar transparan): latar buram di area jam/baterai agar konten yang digulir tidak tertimpa teks status bar */}
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 mx-auto h-[env(safe-area-inset-top)] w-full max-w-[480px] bg-[#0a5c67]/85 backdrop-blur-md dark:bg-[#0a111c]/85" />
      </div>
    </div>
  );
}

/** Header gradien teal (beranda, profil, masuk). Konten di bawahnya boleh menumpuk (margin negatif). */
export function GradientHeader({ children, deep, className }: { children: ReactNode; deep?: boolean; className?: string }) {
  return (
    <div className={cx(deep ? "bg-hero-deep" : "bg-hero", "pt-safe relative w-full overflow-hidden text-white", className)}>
      <span className="pointer-events-none absolute -right-[90px] -top-[70px] size-[280px] rounded-full border border-white/10" />
      <span className="pointer-events-none absolute -right-[40px] -top-[20px] size-[180px] rounded-full border border-white/10" />
      <span className="pointer-events-none absolute right-[10px] top-[30px] size-[90px] rounded-full border border-white/[.08]" />
      <div className="relative">{children}</div>
    </div>
  );
}

/** Halaman bertingkat (detail/pengaturan): bar atas dengan tombol kembali. */
export function SubPage({ title, children, action, back }: { title: string; children: ReactNode; action?: ReactNode; back?: string }) {
  const nav = useNavigate();
  return (
    <div className="animate-page min-h-dvh pb-8">
      <div className="pt-safe sticky top-0 z-20 bg-bg/90 backdrop-blur">
        <div className="flex h-14 items-center gap-1 px-2">
          <button type="button" aria-label="Kembali" onClick={() => (back ? nav(back) : window.history.length > 1 ? nav(-1) : nav("/dashboard"))} className="flex size-11 items-center justify-center rounded-full text-ink active:bg-soft">
            <ChevronLeft size={24} />
          </button>
          <span className="font-display flex-1 truncate text-[18px] font-bold text-ink">{title}</span>
          {action}
        </div>
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

const TABS = [
  { to: "/dashboard", label: "Beranda", icon: House, end: true },
  { to: "/shift", label: "Shift", icon: CalendarDays },
  null, // tombol Presensi
  { to: "/requests", label: "Pengajuan", icon: ClipboardList },
  { to: "/profile", label: "Profil", icon: User },
] as const;

/** Bar navigasi menempel di bawah, tombol tengah menonjol untuk presensi. */
export function BottomNav({ pending, onScan }: { pending: number; onScan: () => void }) {
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[480px] border-t border-line bg-card/95 backdrop-blur">
      <div className="relative flex h-[68px] items-stretch">
        {TABS.map((t, i) =>
          t === null ? (
            <div key="scan" className="flex flex-1 justify-center">
              <button
                type="button"
                onClick={onScan}
                aria-label="Presensi"
                className="bg-cta -mt-6 flex size-[62px] flex-col items-center justify-center rounded-full text-white shadow-[0_8px_20px_rgba(0,122,135,.35)] ring-[5px] ring-bg transition active:scale-95"
              >
                <ScanFace size={26} />
              </button>
            </div>
          ) : (
            <NavLink
              key={t.to}
              to={t.to}
              end={"end" in t ? t.end : false}
              className={({ isActive }) => cx("relative flex flex-1 flex-col items-center justify-center gap-1 text-[11.5px] font-semibold transition", isActive ? "text-brand" : "text-faint")}
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <t.icon size={22} strokeWidth={isActive ? 2.4 : 2} />
                    {i === 3 && pending > 0 && <span className="absolute -right-2 -top-1.5 flex min-w-[17px] items-center justify-center rounded-full bg-bad px-1 text-[9.5px] font-extrabold text-white">{pending > 9 ? "9+" : pending}</span>}
                  </span>
                  {t.label}
                </>
              )}
            </NavLink>
          ),
        )}
      </div>
    </nav>
  );
}
