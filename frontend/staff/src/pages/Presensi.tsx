/** Presensi: 1 · cek lokasi (peta & radius) → 2 · verifikasi wajah live → hasil. */
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, CircleAlert, CircleCheck, Crosshair, MapPinOff, RefreshCw, Satellite, ScanFace } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "../lib/nav";
import { FaceCamera, LocationMap } from "../components/presence";
import { cx, IconTile, PrimaryButton, SecondaryButton, Sheet } from "../components/ui";
import { useVerifier } from "../lib/face/useVerifier";
import { fmtDistance, fmtTime } from "../lib/format";
import { isFresh, useLocation, type LocResult } from "../lib/location";
import { useMe } from "../lib/session";
import { attendanceGate } from "../lib/attendance-gate";

export function PresensiPage() {
  const me = useMe();
  const nav = useNavigate();
  const [step, setStep] = useState<"lokasi" | "wajah">("lokasi");
  const office = me.data?.office ?? null;
  const loc = useLocation(office);
  const t = me.data?.today;
  const gate = attendanceGate(t);
  const purpose = gate.purpose ?? (t?.check_in ? "out" : "in");
  const verb = purpose === "in" ? "Check in" : "Check out";
  useEffect(() => {
    if (!isFresh()) void loc.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!me.data) return null;
  // tidak bisa diabsen sekarang: sudah check out, tanpa jadwal / izin, atau di luar jendela waktu
  const blocked = gate.can ? null : (gate.hint ?? "Tidak bisa absen sekarang.");
  if (blocked)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <IconTile icon={<CircleCheck size={28} />} tone={t?.check_out ? "ok" : "muted"} size={64} />
        <span className="font-display text-[18px] font-bold leading-snug">{blocked}</span>
        <PrimaryButton className="mt-3 max-w-[240px]" onClick={() => nav("/dashboard", { replace: true })}>
          Kembali ke beranda
        </PrimaryButton>
      </div>
    );
  return step === "lokasi" ? <LocationStep r={loc.result} onRefresh={loc.refresh} verb={verb} onBack={() => nav(-1)} onNext={() => setStep("wajah")} /> : <FaceStep purpose={purpose} verb={verb} loc={loc.result} onBack={() => setStep("lokasi")} />;
}

function LocationStep({ r, onRefresh, verb, onBack, onNext }: { r: LocResult; onRefresh: () => void; verb: string; onBack: () => void; onNext: () => void }) {
  const me = useMe();
  const office = me.data?.office ?? null;
  const [icon, tone, title, sub] = ((): [React.ReactNode, "brand" | "ok" | "bad" | "warn", string, string] => {
    switch (r.state) {
      case "checking":
        return [<Satellite key="i" size={22} />, "brand", "Memperbarui lokasi", ""];
      case "valid":
        return [<Check key="i" size={22} />, "ok", "Lokasi valid", `Anda ${fmtDistance(r.distance)} dari titik absensi`];
      case "weak":
        return [<Satellite key="i" size={22} />, "warn", "Sinyal GPS lemah", `Akurasi ±${Math.round(r.fix?.accuracy ?? 0)} m. Pindah ke area terbuka bila bisa.`];
      case "outside":
        return [<MapPinOff key="i" size={22} />, "bad", "Di luar area absensi", `Anda ${fmtDistance(r.distance)} dari titik absensi (radius ${Math.round(office?.radius_m ?? 0)} m)`];
      case "permissionOff":
        return [<MapPinOff key="i" size={22} />, "warn", "Izin lokasi mati", r.message ?? "Aktifkan lokasi untuk melanjutkan presensi"];
      default:
        return [<CircleAlert key="i" size={22} />, "bad", "Lokasi tidak tersedia", r.message ?? "Coba perbarui lokasi"];
    }
  })();
  const canGo = r.state === "valid" || r.state === "weak";
  return (
    <div className="flex h-dvh flex-col">
      <div className="relative flex-1">
        {office ? <LocationMap office={office} fix={r.fix} outside={r.state === "outside"} distance={r.distance} /> : <div className="flex h-full items-center justify-center text-muted">Kantor belum diatur admin.</div>}
        <div className="pt-safe absolute left-3.5 top-3.5">
          <button type="button" aria-label="Kembali" onClick={onBack} className="flex size-[46px] items-center justify-center rounded-full bg-card text-ink shadow-[var(--shadow-soft)] active:scale-95">
            <ChevronLeft size={22} />
          </button>
        </div>
        <button type="button" aria-label="Perbarui lokasi" onClick={onRefresh} className="absolute bottom-3.5 right-3.5 flex size-[46px] items-center justify-center rounded-full bg-card text-brand shadow-[var(--shadow-soft)] active:scale-95">
          <Crosshair size={20} />
        </button>
      </div>
      <div className="animate-sheet rounded-t-[24px] bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-5 shadow-[0_-8px_30px_rgba(15,23,42,.08)]">
        <div className="flex items-center gap-3">
          <IconTile icon={r.state === "checking" ? <RefreshCw size={22} className="animate-spin" /> : icon} tone={tone} size={48} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cx("font-display text-[19px] font-bold", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink")}>{title}</span>
            {sub && <span className="text-[13px] text-muted">{sub}</span>}
          </span>
        </div>
        {r.fix && (
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <Stat l="Jarak" v={fmtDistance(r.distance)} />
            <Stat l="Radius" v={`${Math.round(office?.radius_m ?? 0)} m`} />
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2.5">
          {canGo && (
            <PrimaryButton icon={<ScanFace size={19} />} onClick={onNext}>
              {r.state === "weak" ? "Tetap lanjutkan" : `Lanjut verifikasi wajah`}
            </PrimaryButton>
          )}
          <SecondaryButton icon={<RefreshCw size={17} />} disabled={r.state === "checking"} onClick={onRefresh}>
            Perbarui lokasi
          </SecondaryButton>
        </div>
        <p className="mt-2 text-center text-[12px] text-faint">{verb} · lokasi diperiksa ulang oleh server</p>
      </div>
    </div>
  );
}

const Stat = ({ l, v }: { l: string; v: string }) => (
  <div className="rounded-[14px] bg-soft px-3.5 py-2.5">
    <div className="text-[12px] text-muted">{l}</div>
    <div className="tnum text-[17px] font-bold">{v}</div>
  </div>
);

function FaceStep({ purpose, verb, loc, onBack }: { purpose: "in" | "out"; verb: string; loc: LocResult; onBack: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const v = useVerifier(purpose, () => ({ lat: loc.fix?.lat ?? null, lng: loc.fix?.lng ?? null, accuracy: loc.fix?.accuracy ?? null, is_mocked: false }));
  const running = v.stage === "running" || v.stage === "preparing" || v.stage === "submitting";
  const done = () => {
    for (const k of ["me", "summary", "attendance", "shifts"]) qc.invalidateQueries({ queryKey: [k] });
    nav("/dashboard", { replace: true });
  };
  return (
    <div className="flex min-h-dvh flex-col bg-[#0B1418] text-white">
      <div className="pt-safe flex h-14 items-center gap-1 px-2">
        <button type="button" aria-label="Kembali" disabled={running} onClick={onBack} className="flex size-11 items-center justify-center rounded-full active:bg-white/10 disabled:opacity-40">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[16px] font-bold">{verb} · Wajah</span>
      </div>
      <div className="flex flex-1 flex-col px-4 pb-6">
        <FaceCamera v={v} className="aspect-[3/4] w-full" />
        <p className="mt-4 min-h-[44px] text-center text-[14px] text-white/80">
          {v.stage === "idle" ? (v.faceOk ? "Wajah terdeteksi. Tekan mulai, lalu ikuti gerakan di layar." : "Posisikan wajah di dalam bingkai") : v.stage === "running" ? "Ikuti instruksi di layar" : v.cameraError ?? ""}
        </p>
        <div className="mt-auto">
          <PrimaryButton loading={running} disabled={v.stage === "starting"} onClick={v.start} icon={<ScanFace size={19} />}>
            {v.stage === "running" ? "Sedang memverifikasi…" : v.stage === "submitting" ? "Memeriksa wajah…" : v.stage === "failed" ? "Coba lagi" : "Mulai verifikasi"}
          </PrimaryButton>
        </div>
      </div>
      {/* gagal */}
      <Sheet open={v.stage === "failed" && !!v.fail && !v.cameraError} onClose={() => undefined} dismissible={false}>
        <div className="flex flex-col items-stretch gap-1 pt-2 text-center text-ink">
          <span className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-bad-bg text-bad">
            <CircleAlert size={28} />
          </span>
          <span className="font-display text-[20px] font-bold">{verb} gagal</span>
          <span className="text-[14px] leading-relaxed text-muted">{v.fail?.message}</span>
          {v.fail?.code && <span className="text-[11.5px] text-faint">{v.fail.code}</span>}
          <div className="mt-5 flex flex-col gap-2">
            {v.fail?.canRetry && (
              <PrimaryButton icon={<RefreshCw size={18} />} onClick={v.start}>
                Coba lagi
              </PrimaryButton>
            )}
            <button type="button" onClick={done} className="h-11 text-[15px] font-bold text-muted">
              {v.fail?.canRetry ? "Batal" : "Tutup"}
            </button>
          </div>
        </div>
      </Sheet>
      {/* berhasil */}
      <Sheet open={v.stage === "success"} onClose={done} dismissible={false}>
        <div className="flex flex-col items-stretch gap-1 pt-2 text-center text-ink">
          <span className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-ok-bg text-ok">
            <CircleCheck size={30} />
          </span>
          <span className="font-display text-[20px] font-bold">{verb} diterima</span>
          {v.result?.attendance && (
            <span className="tnum text-[15px] font-semibold text-muted">
              {fmtTime(v.result.attendance.checked_at)} WIB{(v.result.attendance.late_minutes ?? 0) > 0 ? ` · terlambat ${v.result.attendance.late_minutes} mnt` : ""}
              {v.result.distance_m != null ? ` · ${fmtDistance(v.result.distance_m)}` : ""}
            </span>
          )}
          <PrimaryButton className="mt-5" onClick={done}>
            Selesai
          </PrimaryButton>
        </div>
      </Sheet>
    </div>
  );
}
