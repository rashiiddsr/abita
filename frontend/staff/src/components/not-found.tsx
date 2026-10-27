import { AbitaMark } from "./brand";
import { PrimaryButton } from "./ui";
import { useNavigate } from "../lib/nav";

/** Halaman 404 aplikasi karyawan: alamat di bawah /staff yang tidak punya rute. */
export function NotFound() {
  const nav = useNavigate();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <AbitaMark size={56} />
      <span className="font-display mt-2 text-[40px] font-extrabold leading-none text-brand">404</span>
      <span className="font-display text-lg font-bold">Halaman tidak ditemukan</span>
      <span className="text-sm text-muted">Alamat yang Anda buka tidak ada.</span>
      <PrimaryButton onClick={() => nav("/dashboard", { replace: true })} className="mt-3 max-w-[240px]">
        Ke beranda
      </PrimaryButton>
    </div>
  );
}
