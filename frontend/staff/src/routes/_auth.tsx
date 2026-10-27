import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useEffect } from "react";
import { AbitaMark } from "../components/brand";
import { PrimaryButton, SecondaryButton, Spinner } from "../components/ui";
import { ApiError, onUnauthorized } from "../lib/api";
import { Navigate, useLocation, useNavigate } from "../lib/nav";
import { qc } from "../lib/query";
import { logout, useMe, useRealtime } from "../lib/session";

export const Route = createFileRoute("/_auth")({ component: Guard });

/** Butuh sesi: belum masuk -> /login; kata sandi dari admin/email -> /change-password; wajah belum terdaftar -> /enroll-face. */
function Guard() {
  const me = useMe();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    onUnauthorized.fn = () => {
      qc.clear();
      nav("/login", { replace: true });
    };
    return () => {
      onUnauthorized.fn = null;
    };
  }, [nav]);
  useRealtime(!!me.data);
  if (me.isPending)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <AbitaMark size={56} />
        <Spinner />
      </div>
    );
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />;
    if (me.error instanceof ApiError && me.error.status === 403 && /buat kata sandi baru/i.test(me.error.message)) return <Navigate to="/change-password" replace />;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="font-display text-lg font-bold">Tidak bisa memuat akun</span>
        <span className="text-sm text-muted">{(me.error as Error).message}</span>
        <PrimaryButton onClick={() => me.refetch()} className="mt-2 max-w-[220px]">
          Coba lagi
        </PrimaryButton>
      </div>
    );
  }
  const u = me.data.user;
  if (u.role !== "staff")
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <AbitaMark size={56} />
        <span className="font-display mt-2 text-lg font-bold">Akun ini untuk dasbor admin</span>
        <span className="text-sm text-muted">Aplikasi karyawan hanya untuk akun karyawan.</span>
        <SecondaryButton icon={<LogOut size={17} />} onClick={logout} className="mt-3 max-w-[260px]">
          Keluar
        </SecondaryButton>
      </div>
    );
  if (u.must_change_password && loc.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  if (!u.must_change_password && !me.data.face_enrolled && loc.pathname !== "/enroll-face") return <Navigate to="/enroll-face" replace />;
  return <Outlet />;
}
