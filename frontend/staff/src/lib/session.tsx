/** Sesi karyawan: data akun (/me), konfigurasi publik, tema, sinkron real-time, keluar. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, fileUrl } from "./api";
import { disablePush } from "./push";
import type { AppConfig, Me } from "./types";

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/config"), staleTime: 5 * 60_000 });

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), staleTime: 15_000, retry: false });

export async function logout() {
  await disablePush().catch(() => undefined); // perangkat bersama: push akun ini berhenti
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.replace("/staff/login");
}

// ------------------------------------------------------------------ tema

export type ThemeMode = "system" | "light" | "dark";
const THEME_KEY = "abita.theme";

function applyTheme(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0A111C" : "#007A87");
}

const ThemeCtx = createContext<{ mode: ThemeMode; set: (m: ThemeMode) => void }>({ mode: "system", set: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      return (localStorage.getItem(THEME_KEY) as ThemeMode) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    applyTheme(mode);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => mode === "system" && applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode]);
  const set = (m: ThemeMode) => {
    try {
      localStorage.setItem(THEME_KEY, m);
    } catch {
      /* mode privat */
    }
    setMode(m);
  };
  return <ThemeCtx.Provider value={{ mode, set }}>{children}</ThemeCtx.Provider>;
}
export const useTheme = () => useContext(ThemeCtx);

// ------------------------------------------------------------------ real-time

/** Topik event server -> query yang dimuat ulang (jadwal dari Kepala Unit, keputusan pengajuan, notifikasi). */
const KEYS: Record<string, string[]> = {
  schedule: ["shifts", "upcoming", "me"],
  settings: ["config", "shifts", "me"],
  leaves: ["leaves", "me"],
  swaps: ["swaps", "shifts", "upcoming", "me"],
  attendance: ["attendance", "summary", "me"],
  staff: ["me"],
  notifications: ["notifs", "me"],
  files: ["my-folders", "my-folder", "my-folder-files", "my-files"],
};

/**
 * Perubahan dari Admin SDM / Kepala Unit langsung tampil tanpa muat ulang. Saat tersambung ulang, event yang terlewat
 * dikirim ulang berdasarkan id terakhir; seluruh data hanya dimuat ulang bila server mengirim `reset`.
 */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let timer: number | undefined;
    let retry: number | undefined;
    let delay = 5000;
    let lastId = "";
    const pending = new Set<string>();
    const open = () => {
      es = new EventSource(fileUrl(`/events${lastId ? `?last=${encodeURIComponent(lastId)}` : ""}`), { withCredentials: true });
      es.addEventListener("ready", (m) => {
        lastId = (m as MessageEvent).lastEventId || lastId;
        delay = 5000;
      });
      es.addEventListener("reset", () => void qc.invalidateQueries());
      // galat dari server (mis. 502 saat API dimulai ulang) menghentikan EventSource: sambung ulang dengan jeda bertambah
      es.onerror = () => {
        if (es?.readyState !== EventSource.CLOSED) return;
        es = null;
        if (document.visibilityState === "visible") retry = window.setTimeout(open, delay);
        delay = Math.min(delay * 2, 60_000);
      };
      es.onmessage = (m) => {
        lastId = m.lastEventId || lastId;
        try {
          const e = JSON.parse(m.data) as { topic: string };
          for (const k of KEYS[e.topic] ?? []) pending.add(k);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            for (const k of pending) qc.invalidateQueries({ queryKey: [k] });
            pending.clear();
          }, 300);
        } catch {
          /* abaikan */
        }
      };
    };
    // aplikasi di latar belakang: putuskan (hemat baterai); kembali: sambung & segarkan
    const onVis = () => {
      if (document.visibilityState === "visible") {
        if (!es) open();
        qc.invalidateQueries({ queryKey: ["me"] });
      } else {
        es?.close();
        es = null;
        window.clearTimeout(retry);
      }
    };
    open();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      es?.close();
      window.clearTimeout(retry);
      window.clearTimeout(timer);
    };
  }, [enabled, qc]);
}
