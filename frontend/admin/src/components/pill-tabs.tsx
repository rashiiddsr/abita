import { useLayoutEffect, useRef } from "react";
import { cx } from "./ui";

export type PillTab<T extends string> = { value: T; label: string; count?: number; dot?: string };

/**
 * Tab utama halaman (segmented control): wadah abu membulat, sorotan tab aktif bergeser halus.
 * Dipakai untuk filter status/kategori (kiri) dan preset tanggal (kanan) agar tampilan seragam.
 */
export function PillTabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  className,
}: {
  value: T | null;
  tabs: PillTab<T>[];
  onChange: (v: T) => void;
  /** aria-label untuk grup tab */
  label?: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);

  // posisi sorotan diukur dari tombol aktif dan ditulis langsung ke style (tanpa state)
  useLayoutEffect(() => {
    const el = box.current;
    const hl = pill.current;
    if (!el || !hl) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!on) {
        hl.style.opacity = "0";
        return;
      }
      const first = hl.style.opacity !== "1"; // pertama kali tampil: langsung di tempat, tanpa animasi geser
      if (first) hl.style.transition = "none";
      hl.style.opacity = "1";
      hl.style.width = `${on.offsetWidth}px`;
      hl.style.transform = `translateX(${on.offsetLeft}px)`;
      if (first) {
        void hl.offsetWidth;
        hl.style.transition = "";
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, tabs]);

  return (
    <div className={cx("no-scrollbar max-w-full overflow-x-auto", className)}>
      <div ref={box} role="tablist" aria-label={label} className="relative inline-flex h-9 items-center rounded-lg bg-track p-[3px]">
        <span
          ref={pill}
          aria-hidden
          className="absolute bottom-[3px] left-0 top-[3px] rounded-md bg-raised opacity-0 shadow-[0_1px_2px_rgba(16,24,40,.1),0_0_0_1px_rgba(16,24,40,.04)] transition-[transform,width] duration-200 ease-out"
        />
        {tabs.map((t) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.value)}
              className={cx(
                "relative z-10 flex h-full flex-none items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors",
                on ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {t.dot && <span className="size-1.5 flex-none rounded-full" style={{ background: t.dot }} />}
              {t.label}
              {t.count != null && <span className={cx("tnum text-xs", on ? "text-muted" : "text-faint")}>{t.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
