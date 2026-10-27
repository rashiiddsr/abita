/** Lembar Rekap (menu Shift): rekap kehadiran sendiri per periode + unduh PDF / Excel. */
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { api, errMsg, fileUrl } from "../lib/api";
import { isoMonth, monthStart, shiftMonth, todayWib } from "../lib/format";
import type { MyRecap } from "../lib/types";
import { cx, Pill, PrimaryButton, SecondaryButton, Segmented, Sheet, Skel, useToast } from "./ui";

type Period = "1" | "3" | "6" | "year";
const PERIODS: { value: Period; label: string }[] = [
  { value: "1", label: "Bulan ini" },
  { value: "3", label: "3 bulan" },
  { value: "6", label: "6 bulan" },
  { value: "year", label: "Tahun ini" },
];

/** [awal, akhir] periode relatif, berakhir hari ini. */
function range(p: Period, today: string): [string, string] {
  if (p === "year") return [`${today.slice(0, 4)}-01-01`, today];
  return [monthStart(shiftMonth(isoMonth(today), 1 - Number(p))), today];
}

export function RecapSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const today = todayWib();
  const [period, setPeriod] = useState<Period>("1");
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [from, to] = range(period, today);
  const q = useQuery({ queryKey: ["recap", from, to], queryFn: () => api<MyRecap>("/me/recap", { query: { from, to } }), enabled: open });
  const r = q.data;

  async function download(format: "pdf" | "xlsx") {
    setBusy(format);
    try {
      const res = await fetch(fileUrl(`/me/recap/export?from=${from}&to=${to}&format=${format}`), { credentials: "include" });
      if (!res.ok) throw new Error("Rekap tidak bisa diunduh. Coba lagi.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = (res.headers.get("Content-Disposition") ?? "").match(/filename="([^"]+)"/)?.[1] ?? `Rekap_${from}_${to}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Rekap kehadiran">
      <div className="flex flex-col gap-4 pt-2">
        <Segmented value={period} items={PERIODS} onChange={setPeriod} />
        {!r ? (
          q.isError ? <p className="text-[14px] font-semibold text-bad">{errMsg(q.error)}</p> : <Skel className="h-[188px]" />
        ) : (
          <div className="rounded-[18px] border border-line">
            <div className="flex items-center border-b border-line px-4 py-3">
              <span className="flex-1 text-[13px] font-semibold text-muted">{r.label}</span>
              <Pill tone={r.punctuality_pct === null || r.punctuality_pct >= 90 ? "ok" : "warn"}>{r.punctuality_pct === null ? "—" : `${Math.round(r.punctuality_pct)}% tepat waktu`}</Pill>
            </div>
            <div className="grid grid-cols-3">
              <Stat label="Hari kerja" value={r.scheduled} />
              <Stat label="Hadir" value={r.present} tone="text-ok" />
              <Stat label="Terlambat" value={r.late} tone={r.late ? "text-bad" : undefined} />
              <Stat label="Izin" value={r.izin} tone="text-purple" top />
              <Stat label="Sakit" value={r.sakit} tone="text-purple" top />
              <Stat label="Tidak hadir" value={r.absent} tone={r.absent ? "text-bad" : undefined} top />
            </div>
          </div>
        )}
        <div className="flex gap-2.5">
          <PrimaryButton icon={<FileText size={18} />} loading={busy === "pdf"} disabled={!r || !!busy} onClick={() => download("pdf")}>
            {busy === "pdf" ? "Memproses…" : "Unduh PDF"}
          </PrimaryButton>
          <SecondaryButton icon={<FileSpreadsheet size={18} />} loading={busy === "xlsx"} disabled={!r || !!busy} onClick={() => download("xlsx")} className="h-[52px]">
            {busy === "xlsx" ? "Memproses…" : "Excel"}
          </SecondaryButton>
        </div>
      </div>
    </Sheet>
  );
}

function Stat({ label, value, tone, top }: { label: string; value: number; tone?: string; top?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center gap-0.5 py-3.5 [&:not(:nth-child(3n+1))]:border-l [&:not(:nth-child(3n+1))]:border-line", top && "border-t border-line")}>
      <span className={cx("font-display tnum text-[22px] font-bold", tone ?? "text-ink")}>{value}</span>
      <span className="text-[12px] text-muted">{label}</span>
    </div>
  );
}
