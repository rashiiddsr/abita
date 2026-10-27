import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { accessFor, type Access } from "./access";
import { api } from "./api";
import type { Me, UnitOut } from "./types";

interface Session {
  me: Me;
  /** Hak akses peran ini (menu, aksi, bagian pengaturan): lib/access.ts. */
  can: Access;
  /** Admin SDM: akses semua unit. */
  isGlobal: boolean;
  /** Admin SDM: memantau (baca saja) + pengaturan operasional. */
  isHr: boolean;
  /** Kepala Unit. */
  isHead: boolean;
  /** Unit aktif Kepala Unit (null untuk Admin SDM). */
  ownUnit: string | null;
  /** Unit yang dipimpin Kepala Unit (1–2); kosong untuk Admin SDM. */
  headUnits: string[];
  /** Filter unit di sidebar: Admin SDM ("all" = semua unit) atau Kepala Unit yang memimpin beberapa unit. */
  scope: string;
  setScope: (u: string) => void;
  units: UnitOut[];
  /** Unit yang punya Kepala Unit (untuk aturan persetujuan & jadwal). */
  headed: Set<string>;
  /** Unit aktif yang mengunci semua halaman: unit Kepala Unit, atau pilihan unit di sidebar. null = semua unit. */
  lockedUnit: string | null;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession di luar SessionProvider");
  return s;
}

/** Unit efektif untuk query: Kepala Unit selalu unitnya, Admin SDM sesuai pilihan. */
export function useScopeUnit(local?: string): string | undefined {
  const s = useSession();
  if (s.ownUnit) return s.ownUnit;
  const v = local ?? s.scope;
  return v === "all" ? undefined : v;
}

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const isGlobal = me.user.role === "admin";
  const scope = useSyncExternalStore(subscribeScope, readScope, () => "all");
  const setScope = (u: string) => {
    try {
      localStorage.setItem(SCOPE_KEY, u);
    } catch {}
    window.dispatchEvent(new Event(SCOPE_EVENT));
  };
  const units = useQuery({ queryKey: ["units"], queryFn: () => api<UnitOut[]>("/api/v1/admin/units"), staleTime: 5 * 60_000 });
  const list = units.data ?? [];
  // Kepala Unit 1 unit: selalu unitnya. Kepala Unit beberapa unit: seperti Admin SDM, default "Semua unit" (semua unitnya)
  // dengan pilihan unit di sidebar.
  const headUnits = me.user.role === "unit_head" ? me.user.head_units : [];
  const own = isGlobal ? null : headUnits.length > 1 ? (headUnits.includes(scope) ? scope : null) : (headUnits[0] ?? me.user.unit);
  const value: Session = {
    me,
    can: accessFor(me.user.role),
    isGlobal,
    isHr: me.user.role === "admin",
    isHead: me.user.role === "unit_head",
    ownUnit: own,
    headUnits,
    scope: isGlobal ? scope : (own ?? "all"),
    setScope,
    units: list,
    headed: new Set(list.filter((u) => u.heads.length).map((u) => u.name)),
    lockedUnit: isGlobal ? (scope === "all" ? null : scope) : own,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Filter unit global disimpan per browser (localStorage), dibaca lewat external store.
const SCOPE_KEY = "presensi.scope";
const SCOPE_EVENT = "presensi-scope";

function subscribeScope(cb: () => void) {
  window.addEventListener(SCOPE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(SCOPE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function readScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) || "all";
  } catch {
    return "all";
  }
}

const noopSubscribe = () => () => {};

/** Nilai yang hanya dihitung di browser (null saat render server), agar tanggal/jam tidak beda saat hidrasi. */
export function useMounted<T>(fn: () => T): T | null {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return mounted ? fn() : null;
}
