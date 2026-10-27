import { useQuery } from "@tanstack/react-query";
import { Building2, CornerDownLeft, FileText, LayoutGrid, Search, User as UserIcon, X } from "lucide-react";
import { useRouter } from "@/lib/nav";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuKey, SettingsSection } from "@/lib/access";
import { api } from "@/lib/api";
import { fmtRange } from "@/lib/format";
import { useSession } from "@/lib/session";
import { REQ, tipe, toneStyle } from "@/lib/status";
import type { LeaveOut, User } from "@/lib/types";
import { cx } from "./ui";

type Item = { key: string; group: string; title: string; sub?: string; href: string; unit?: string; icon: ReactNode; badge?: { label: string; bg: string; fg: string } };

// Hanya halaman & bagian pengaturan yang boleh dibuka peran ini (lib/access.ts)
const PAGES: { title: string; href: string; menu: MenuKey; words?: string }[] = [
  { title: "Dashboard", href: "/dashboard", menu: "dashboard", words: "beranda ringkasan" },
  { title: "Absensi", href: "/attendance", menu: "absensi", words: "kehadiran check in" },
  { title: "Pengajuan", href: "/requests", menu: "pengajuan", words: "izin sakit persetujuan skd tukar" },
  { title: "Karyawan", href: "/staff", menu: "karyawan", words: "staff magang outsourcing pegawai" },
  { title: "Jadwal / Shift", href: "/schedule", menu: "jadwal", words: "shift tukar jadwal" },
  { title: "Laporan", href: "/reports", menu: "laporan", words: "rekap ekspor excel pdf" },
  { title: "Kelola Unit", href: "/units", menu: "kelolaUnit", words: "unit kepala unit" },
  { title: "Kelola Admin", href: "/admins", menu: "kelolaAdmin", words: "akun admin peran kepala unit it" },
  { title: "Profil saya", href: "/profile", menu: "profil", words: "kata sandi password foto" },
];
const SETTINGS: { title: string; sec: SettingsSection; words?: string }[] = [
  { title: "Lokasi presensi", sec: "lokasi", words: "radius titik kantor peta" },
  { title: "Jam shift", sec: "shift", words: "toleransi terlambat" },
  { title: "Pola jadwal", sec: "pola", words: "rotasi shift" },
  { title: "Kontak bantuan", sec: "bantuan", words: "helpdesk whatsapp email" },
  { title: "Konfigurasi SMTP", sec: "smtp", words: "email smtp server" },
  { title: "Notifikasi", sec: "notif", words: "pemberitahuan pengingat" },
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/**
 * Pencarian global di navbar: karyawan, pengajuan, unit, dan halaman. Ctrl/⌘ + K untuk fokus.
 * Di layar kecil tampil sebagai tombol ikon yang membuka panel pencarian penuh.
 */
export function GlobalSearch() {
  const s = useSession();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // data dimuat saat pencarian pertama kali dibuka (lalu memakai cache kueri yang sama dengan halaman lain)
  const [armed, setArmed] = useState(false);
  const staff = useQuery({ queryKey: ["users", "staff"], queryFn: () => api<User[]>("/api/v1/admin/users", { query: { role: "staff" } }), enabled: armed });
  const leaves = useQuery({ queryKey: ["leaves", "all"], queryFn: () => api<LeaveOut[]>("/api/v1/admin/leaves"), enabled: armed && s.can.monitor });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setArmed(true);
        if (window.matchMedia("(min-width: 768px)").matches) {
          inputRef.current?.focus();
          setOpen(true);
        } else {
          setMobile(true);
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  useEffect(() => {
    if (mobile) mobileRef.current?.focus();
  }, [mobile]);

  const items = useMemo<Item[]>(() => {
    const k = norm(q.trim());
    const out: Item[] = [];
    const has = (...xs: (string | null | undefined)[]) => xs.some((x) => x && norm(x).includes(k));
    if (k) {
      for (const u of (staff.data ?? []).filter((u) => has(u.name, u.employee_code, u.unit, u.email, u.institution)).slice(0, 6)) {
        const t = tipe(u.employment_type);
        out.push({
          key: `u${u.id}`,
          group: "Karyawan",
          title: u.name,
          sub: [u.employee_code, u.unit].filter(Boolean).join(" · "),
          href: `/staff/${u.id}`,
          icon: <UserIcon size={16} />,
          badge: u.is_active === false ? { label: "Nonaktif", bg: "#F4F6F8", fg: "#5B6678" } : { label: t.label, bg: t.bg, fg: t.fg },
        });
      }
      const lv = (leaves.data ?? [])
        .filter((l) => has(l.name, l.employee_code, l.unit, l.kind, l.reason))
        .sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || b.created_at.localeCompare(a.created_at))
        .slice(0, 5);
      for (const l of lv) {
        const st = REQ[l.status];
        out.push({
          key: `l${l.id}`,
          group: "Pengajuan",
          title: `${l.kind === "sakit" ? "Sakit" : "Izin"} · ${l.name}`,
          sub: `${fmtRange(l.start_date, l.end_date)} · ${l.reason}`,
          href: `/requests/${l.id}`,
          icon: <FileText size={16} />,
          badge: { label: st.label, bg: st.bg, fg: st.fg },
        });
      }
      if (s.can.unitFilter) {
        // memilih unit = mengganti filter unit global, lalu membuka halaman pemantauan
        const href = s.can.menus.has("absensi") ? "/attendance" : "/staff";
        for (const u of s.units.filter((u) => has(u.name, u.head_name)).slice(0, 4)) {
          out.push({ key: `n${u.id}`, group: "Unit", title: u.name, sub: `${u.staff_count} karyawan · ${u.head_name ?? "—"}`, href, unit: u.name, icon: <Building2 size={16} /> });
        }
      }
    }
    const pages = [
      ...PAGES.filter((p) => s.can.menus.has(p.menu)),
      ...SETTINGS.filter((x) => s.can.settings.includes(x.sec)).map((x) => ({ title: x.title, href: `/settings?sec=${x.sec}`, words: `pengaturan ${x.words ?? ""}` })),
    ].filter((p) => !k || has(p.title, p.words));
    for (const p of pages.slice(0, k ? 5 : 7)) out.push({ key: `p${p.href}`, group: k ? "Halaman" : "Buka halaman", title: p.title, href: p.href, icon: <LayoutGrid size={16} /> });
    return out;
  }, [q, staff.data, leaves.data, s.can, s.units]);

  const sel = Math.min(active, Math.max(0, items.length - 1));
  function go(it: Item | undefined) {
    if (!it) return;
    if (it.unit) s.setScope(it.unit);
    router.push(it.href);
    setOpen(false);
    setMobile(false);
    setQ("");
    inputRef.current?.blur();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((sel + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((sel - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[sel]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setMobile(false);
      inputRef.current?.blur();
    }
  }
  const loading = q.trim() && (staff.isLoading || leaves.isLoading);
  const results = (
    <Results items={items} sel={sel} loading={!!loading} empty={!!q.trim() && items.length === 0 && !loading} q={q} onHover={setActive} onPick={go} />
  );
  const change = (v: string) => {
    setQ(v);
    setActive(0);
  };

  return (
    <>
      <div ref={boxRef} className="relative mx-auto hidden w-full max-w-[560px] md:block">
        <label
          className={cx(
            "flex h-[42px] items-center gap-2 rounded-full bg-card px-3.5 text-faint transition-shadow",
            open ? "shadow-[0_0_0_2px_#007A87]" : "shadow-[inset_0_0_0_1px_var(--color-line)]",
          )}
        >
          <Search size={16} strokeWidth={2.2} className="flex-none" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => change(e.target.value)}
            onFocus={() => {
              setArmed(true);
              setOpen(true);
            }}
            onKeyDown={onKey}
            placeholder="Cari karyawan, NIK, pengajuan, atau halaman…"
            aria-label="Pencarian global"
            className="w-full min-w-0 bg-transparent text-[13.5px] font-medium text-ink outline-none"
          />
          {q ? (
            <button onClick={() => change("")} aria-label="Hapus pencarian" className="text-faint">
              <X size={15} />
            </button>
          ) : (
            <kbd className="hidden flex-none rounded-md bg-soft px-1.5 py-0.5 text-[11px] font-medium text-muted lg:block">Ctrl K</kbd>
          )}
        </label>
        {open && <div className="absolute inset-x-0 top-[50px] z-30 overflow-hidden rounded-xl bg-card shadow-pop">{results}</div>}
      </div>

      <button
        onClick={() => {
          setArmed(true);
          setMobile(true);
        }}
        aria-label="Cari"
        className="flex size-[42px] flex-none items-center justify-center rounded-full bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line)] md:hidden"
      >
        <Search size={19} />
      </button>
      {mobile && (
        // layar sempit: pencarian sebagai modal di atas halaman
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Pencarian global">
          <div className="absolute inset-0 bg-[rgba(13,23,38,.42)]" onClick={() => setMobile(false)} />
          <div className="animate-rise relative mx-4 mt-16 overflow-hidden rounded-xl bg-card shadow-card">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Search size={16} className="flex-none text-faint" />
              <input
                ref={mobileRef}
                value={q}
                onChange={(e) => change(e.target.value)}
                onKeyDown={onKey}
                placeholder="Cari karyawan, NIK, pengajuan…"
                className="h-9 w-full min-w-0 bg-transparent text-[15px] font-medium text-ink outline-none"
              />
              <button onClick={() => setMobile(false)} aria-label="Tutup pencarian" className="flex size-8 flex-none items-center justify-center rounded-full bg-soft text-muted">
                <X size={15} />
              </button>
            </div>
            {results}
          </div>
        </div>
      )}
    </>
  );
}

function Results({
  items,
  sel,
  loading,
  empty,
  q,
  onHover,
  onPick,
}: {
  items: Item[];
  sel: number;
  loading: boolean;
  empty: boolean;
  q: string;
  onHover: (i: number) => void;
  onPick: (it: Item) => void;
}) {
  return (
    <div className="max-h-[min(460px,70vh)] overflow-y-auto p-2" role="listbox">
      {loading && <div className="px-3 py-2.5 text-[12.5px] font-medium text-faint">Mencari…</div>}
      {empty && (
        <div className="px-3 py-6 text-center text-[13px] font-medium text-muted">
          Tidak ada hasil untuk <span className="text-ink">“{q.trim()}”</span>
        </div>
      )}
      {items.map((it, i) => {
        const head = i === 0 || items[i - 1].group !== it.group ? it.group : null;
        return (
          <div key={it.key}>
            {head && <div className="px-3 pb-1 pt-2.5 text-[11.5px] font-medium uppercase tracking-[.04em] text-faint">{head}</div>}
            <button
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(it)}
              className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", i === sel && "bg-soft")}
            >
              <span className={cx("flex size-8 flex-none items-center justify-center rounded-[10px]", i === sel ? "bg-brand-soft text-brand" : "bg-soft text-muted")}>{it.icon}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] font-medium">{it.title}</span>
                {it.sub && <span className="truncate text-xs font-medium text-faint">{it.sub}</span>}
              </span>
              {it.badge && (
                <span className="flex-none rounded-full px-2 py-0.5 text-[11px] font-medium" style={toneStyle(it.badge.bg, it.badge.fg)}>
                  {it.badge.label}
                </span>
              )}
              {i === sel && <CornerDownLeft size={14} className="flex-none text-faint" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
