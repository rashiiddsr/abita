import { createFileRoute, Outlet } from "@tanstack/react-router";
import { BottomNav } from "../../components/shell";
import { useToast } from "../../components/ui";
import { useNavigate } from "../../lib/nav";
import { useEffect } from "react";
import { attendanceGate } from "../../lib/attendance-gate";
import { syncPush } from "../../lib/push";
import { useMe } from "../../lib/session";

export const Route = createFileRoute("/_auth/_tabs")({ component: Tabs });

/** Tab utama + bar navigasi bawah. */
function Tabs() {
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const uid = me.data?.user.id;
  useEffect(() => {
    if (uid) void syncPush(); // langganan push perangkat ini ikut akun yang sedang masuk
  }, [uid]);
  const scan = () => {
    const g = attendanceGate(me.data?.today);
    if (me.data && !g.can) return toast(g.hint ?? "Tidak bisa absen sekarang.");
    nav("/attendance");
  };
  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <Outlet />
      <BottomNav pending={me.data?.pending_requests ?? 0} onScan={scan} />
    </div>
  );
}
