import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiUrl } from "./api";

/** Topik event server (backend: src/core/events.ts) -> query yang dimuat ulang. */
const KEYS: Record<string, string[]> = {
  files: ["folders", "folder", "folder-files", "staff-files", "employee-files", "file-categories"],
  schedule: ["shifts", "schedule", "schedule-index", "patterns", "staff-detail", "dashboard", "daily", "report"],
  settings: ["settings", "shift-types", "office", "holidays", "patterns", "shifts", "daily", "dashboard"],
  leaves: ["leaves", "leave", "pending-count", "dashboard", "staff-detail", "daily", "daily-detail", "report"],
  swaps: ["swaps", "pending-count", "dashboard", "shifts", "schedule", "staff-detail"],
  staff: ["staff", "users", "staff-detail", "units", "dashboard", "schedule-index"],
  units: ["units", "users", "staff"],
  attendance: ["daily", "daily-detail", "attendance-summary", "attendance-days", "dashboard", "summary", "staff-detail", "report"],
  notifications: ["notifs", "pending-count"],
};

/**
 * Perubahan dari pengguna lain (Admin SDM, Kepala Unit, karyawan) langsung tampil tanpa muat ulang halaman.
 * Server menutup aliran secara berkala; saat tersambung ulang, event yang terlewat dikirim ulang berdasarkan id terakhir.
 * Seluruh data hanya dimuat ulang bila server mengirim `reset` (event terlewat tidak lagi tersedia, mis. API dimulai ulang).
 * Bila server membalas galat (mis. 502), sambungan dibuka ulang manual dengan jeda bertambah (5–60 detik).
 */
export function useRealtime(meId: number) {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | undefined;
    let delay = 5000;
    let lastId = "";
    const pending = new Set<string>();
    let timer: number | undefined;
    const flush = () => {
      for (const k of pending) qc.invalidateQueries({ queryKey: [k] });
      pending.clear();
    };
    const onMessage = (m: MessageEvent) => {
      let e: { topic: string; by: number | null };
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }
      if (e.by === meId) return; // perubahan sendiri sudah dimuat ulang oleh halaman yang mengubah
      for (const k of KEYS[e.topic] ?? []) pending.add(k);
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 250); // gabungkan event yang beruntun
    };
    const open = () => {
      es = new EventSource(apiUrl(`/api/v1/events${lastId ? `?last=${encodeURIComponent(lastId)}` : ""}`), { withCredentials: true });
      es.onmessage = (m) => {
        lastId = m.lastEventId || lastId;
        onMessage(m);
      };
      es.addEventListener("ready", (m) => {
        lastId = (m as MessageEvent).lastEventId || lastId;
        delay = 5000;
      });
      es.addEventListener("reset", () => void qc.invalidateQueries());
      es.onerror = () => {
        if (es?.readyState !== EventSource.CLOSED) return; // browser menyambung ulang sendiri dengan Last-Event-ID
        es = null;
        retry = window.setTimeout(open, delay);
        delay = Math.min(delay * 2, 60_000);
      };
    };
    open();
    return () => {
      es?.close();
      window.clearTimeout(retry);
      window.clearTimeout(timer);
    };
  }, [qc, meId]);
}
