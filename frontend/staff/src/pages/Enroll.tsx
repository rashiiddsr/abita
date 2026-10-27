/** Daftar wajah (pertama kali masuk) atau pindai ulang (harus cocok dengan wajah lama dulu). */
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, CircleAlert, CircleCheck, LogOut, RefreshCw, ScanFace, Sun, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "../lib/nav";
import { FaceCamera } from "../components/presence";
import { PrimaryButton, Sheet } from "../components/ui";
import { useVerifier } from "../lib/face/useVerifier";
import { logout } from "../lib/session";

export function EnrollPage({ reenroll = false }: { reenroll?: boolean }) {
  const [started, setStarted] = useState(reenroll);
  return started ? <EnrollCamera reenroll={reenroll} /> : <EnrollIntro onStart={() => setStarted(true)} />;
}

function EnrollIntro({ onStart }: { onStart: () => void }) {
  return (
    <div className="pt-safe animate-page flex min-h-dvh flex-col px-5 pb-6">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="bg-cta flex size-20 items-center justify-center rounded-[26px] text-white shadow-[var(--shadow-cta)]">
          <ScanFace size={38} />
        </span>
        <h1 className="font-display mt-6 text-[24px] font-bold">Daftarkan wajah Anda</h1>
        <p className="mt-2 max-w-[320px] text-[14.5px] leading-relaxed text-muted">Wajah dipakai untuk memastikan presensi dilakukan oleh Anda sendiri. Pendaftaran hanya sekali.</p>
        <div className="mt-7 flex w-full max-w-[340px] flex-col gap-3 text-left">
          <Tip icon={<Sun size={18} />} text="Cari tempat yang cukup terang" />
          <Tip icon={<UserRound size={18} />} text="Lepas masker dan kacamata hitam" />
          <Tip icon={<RefreshCw size={18} />} text="Ikuti gerakan: hadap, toleh kiri & kanan" />
        </div>
      </div>
      <PrimaryButton icon={<ScanFace size={19} />} onClick={onStart}>
        Mulai pendaftaran
      </PrimaryButton>
      <button type="button" onClick={logout} className="mx-auto mt-3 flex h-10 items-center gap-2 text-[14px] font-bold text-muted">
        <LogOut size={16} /> Keluar
      </button>
    </div>
  );
}

const Tip = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <div className="flex items-center gap-3 rounded-[16px] bg-card p-3.5 shadow-[var(--shadow-soft)]">
    <span className="flex size-9 items-center justify-center rounded-[12px] bg-brand-soft text-brand">{icon}</span>
    <span className="text-[14px] font-semibold">{text}</span>
  </div>
);

function EnrollCamera({ reenroll }: { reenroll: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const v = useVerifier(reenroll ? "reenroll" : "enroll", () => ({}));
  const running = v.stage === "running" || v.stage === "preparing" || v.stage === "submitting";
  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
    nav(reenroll ? "/account" : "/dashboard", { replace: true });
  };
  return (
    <div className="flex min-h-dvh flex-col bg-[#0B1418] text-white">
      <div className="pt-safe flex h-14 items-center gap-1 px-2">
        {reenroll && (
          <button type="button" aria-label="Kembali" disabled={running} onClick={() => nav(-1)} className="flex size-11 items-center justify-center rounded-full active:bg-white/10 disabled:opacity-40">
            <ChevronLeft size={24} />
          </button>
        )}
        <span className="px-2 text-[16px] font-bold">{reenroll ? "Pindai ulang wajah" : "Daftar wajah"}</span>
      </div>
      <div className="flex flex-1 flex-col px-4 pb-6">
        <FaceCamera v={v} className="aspect-[3/4] w-full" />
        <p className="mt-4 min-h-[44px] text-center text-[14px] text-white/80">
          {v.stage === "idle" ? (v.faceOk ? "Wajah terdeteksi. Tekan mulai, lalu ikuti gerakan di layar." : "Posisikan wajah di dalam bingkai") : v.stage === "running" ? "Ikuti instruksi di layar" : (v.cameraError ?? "")}
        </p>
        <PrimaryButton className="mt-auto" loading={running} disabled={v.stage === "starting"} onClick={v.start} icon={<ScanFace size={19} />}>
          {v.stage === "failed" ? "Coba lagi" : running ? "Memproses…" : "Mulai"}
        </PrimaryButton>
      </div>
      <Sheet open={v.stage === "failed" && !!v.fail && !v.cameraError} onClose={() => undefined} dismissible={false}>
        <div className="flex flex-col items-stretch gap-1 pt-2 text-center text-ink">
          <span className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-bad-bg text-bad">
            <CircleAlert size={28} />
          </span>
          <span className="font-display text-[20px] font-bold">Belum berhasil</span>
          <span className="text-[14px] leading-relaxed text-muted">{v.fail?.message}</span>
          <div className="mt-5 flex flex-col gap-2">
            {v.fail?.canRetry ? (
              <PrimaryButton icon={<RefreshCw size={18} />} onClick={v.start}>
                Coba lagi
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={finish}>Tutup</PrimaryButton>
            )}
          </div>
        </div>
      </Sheet>
      <Sheet open={v.stage === "success"} onClose={finish} dismissible={false}>
        <div className="flex flex-col items-stretch gap-1 pt-2 text-center text-ink">
          <span className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-ok-bg text-ok">
            <CircleCheck size={30} />
          </span>
          <span className="font-display text-[20px] font-bold">{v.result?.message ?? "Berhasil"}</span>
          <span className="text-[14px] text-muted">{reenroll ? "Data wajah Anda sudah diperbarui." : "Sekarang Anda bisa presensi dengan wajah."}</span>
          <PrimaryButton className="mt-5" onClick={finish}>
            Lanjut
          </PrimaryButton>
        </div>
      </Sheet>
    </div>
  );
}
