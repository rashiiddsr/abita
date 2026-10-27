import { CalendarPlus, Clock3, Phone } from "lucide-react";
import { fmtAgo, fmtDate, phoneDisplay } from "@/lib/format";
import { EMP_STATUS, ROLE_LABEL, ROLE_TONE } from "@/lib/status";
import type { User } from "@/lib/types";
import { Avatar, Drawer, GreyTag, Pill, Tag, cx } from "./ui";

/** Detail akun admin (Kelola Admin): panel kanan, tata letak sama dengan Detail absensi. */
export function AdminDetailDrawer({ user: u, onClose }: { user: User | null; onClose: () => void }) {
  return (
    <Drawer open={!!u} onClose={onClose} title="Detail admin">
      {u && <Body u={u} />}
    </Drawer>
  );
}

function Body({ u }: { u: User }) {
  const active = u.is_active !== false;
  const role = ROLE_TONE[u.role] ?? { label: ROLE_LABEL[u.role], bg: "#F4F6F8", fg: "#5B6678" };
  const facts = [
    { label: "Terakhir aktif", value: u.last_seen_at ? fmtAgo(u.last_seen_at) : "—", icon: Clock3 },
    { label: "Dibuat", value: fmtDate(u.created_at.slice(0, 10)), icon: CalendarPlus },
    { label: "Nomor HP", value: phoneDisplay(u.phone), icon: Phone },
  ];
  return (
    <>
      <div className="flex items-center gap-3.5">
        <Avatar name={u.name} size={52} radius={8} userId={u.id} photo={u.has_avatar} bg="var(--color-soft)" fg="var(--color-muted)" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[17px] font-semibold">{u.name}</span>
          <span className="truncate text-[12.5px] font-medium text-muted">{u.email ?? "—"}</span>
        </div>
        <Pill tone={EMP_STATUS[active ? "aktif" : "nonaktif"]} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Tag tone={role} className="px-2.5 py-1 text-xs" />
        <GreyTag>{u.role === "unit_head" ? u.head_units.join(", ") || "—" : "Semua unit"}</GreyTag>
      </div>
      <div className="grid grid-cols-3 rounded-xl bg-soft">
        {facts.map((f, i) => (
          <div key={f.label} className={cx("flex min-w-0 flex-col gap-2 p-3", i && "border-l border-line")}>
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-card text-brand">
              <f.icon size={16} strokeWidth={2.2} />
            </span>
            <div className="flex min-w-0 flex-col gap-px">
              <span className="text-xs font-medium text-muted">{f.label}</span>
              <span className="tnum truncate text-[15px] font-semibold">{f.value}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
