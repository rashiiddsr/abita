import { LogoMark } from "@/components/brand";
import { Link } from "@/lib/nav";

/** Halaman 404 dasbor: alamat di bawah /admin yang tidak punya rute. */
export function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-4 text-center">
      <LogoMark size={48} />
      <div className="flex flex-col gap-1.5">
        <span className="text-[44px] font-semibold leading-none tracking-tight text-brand">404</span>
        <h1 className="text-lg font-semibold text-ink">Halaman tidak ditemukan</h1>
        <p className="max-w-[320px] text-sm text-muted">Alamat yang Anda buka tidak ada di dasbor.</p>
      </div>
      <Link href="/dashboard" className="flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
        Ke dashboard
      </Link>
    </main>
  );
}
