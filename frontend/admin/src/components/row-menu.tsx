import { EllipsisVertical } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./ui";

export type RowAction = { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void; hidden?: boolean };

/** Tombol ⋮ dengan menu aksi. Menu memakai posisi fixed agar tidak terpotong tabel yang bisa digulir. */
export function RowMenu({ actions, label = "Aksi" }: { actions: RowAction[]; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const items = actions.filter((a) => !a.hidden);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("mousedown", close);
    };
  }, [pos]);
  if (items.length === 0) return <span className="size-8" />;
  return (
    <>
      <button
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          const b = e.currentTarget.getBoundingClientRect();
          setPos(pos ? null : { top: b.bottom + 4, left: b.right - 200 });
        }}
        className={cx("flex size-8 items-center justify-center rounded-lg text-muted hover:bg-soft hover:text-ink", pos && "bg-soft text-ink")}
      >
        <EllipsisVertical size={16} />
      </button>
      {pos && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-40 flex w-[200px] flex-col rounded-xl bg-card p-1 shadow-pop"
          style={{ top: Math.min(pos.top, window.innerHeight - 44 * items.length - 16), left: Math.max(8, pos.left) }}
        >
          {items.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              onClick={() => {
                setPos(null);
                a.onClick();
              }}
              className={cx("flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px]", a.danger ? "text-bad hover:bg-bad-bg" : "text-ink hover:bg-soft")}
            >
              {a.icon && <span className={cx("flex", a.danger ? "text-bad" : "text-muted")}>{a.icon}</span>}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
