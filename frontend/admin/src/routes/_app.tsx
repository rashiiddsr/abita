import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/shell";

// Layout dasbor (sidebar + header) untuk semua halaman yang butuh login. AppShell menunggu sesi (/api/v1/me):
// belum masuk -> /login, kata sandi dari admin/email -> /change-password.
export const Route = createFileRoute("/_app")({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
