import { metersPerPixel, offsetPx, tilesFor } from "@/lib/map";

/** Peta mini: titik kantor + radius, dan titik lokasi presensi (bila ada). */
export function MiniMap({
  center,
  radiusM,
  point,
  ok,
  w,
  h,
  zoom = 15,
  className,
  rounded = 14,
}: {
  center: { lat: number; lng: number };
  radiusM: number;
  point?: { lat: number; lng: number } | null;
  ok?: boolean;
  w: number;
  h: number;
  zoom?: number;
  className?: string;
  rounded?: number;
}) {
  const tiles = tilesFor(center.lat, center.lng, zoom, w, h);
  const r = Math.max(6, radiusM / metersPerPixel(center.lat, zoom));
  let dot: { x: number; y: number } | null = null;
  if (point) {
    const o = offsetPx(center, point, zoom);
    dot = { x: Math.min(w - 8, Math.max(8, w / 2 + o.dx)), y: Math.min(h - 8, Math.max(8, h / 2 + o.dy)) };
  }
  return (
    <span className={`relative block flex-none overflow-hidden bg-[#EEF0EC] ${className ?? ""}`} style={{ width: w, height: h, borderRadius: rounded }}>
      {tiles.map((t) => (
        <img
          key={t.url}
          src={t.url}
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{ left: t.left, top: t.top, width: 256, height: 256, filter: "saturate(.3) brightness(1.05) contrast(.92)" }}
        />
      ))}
      <span
        className="absolute rounded-full border-[1.5px] border-brand bg-[rgba(0,122,135,.12)] transition-all duration-200"
        style={{ left: w / 2 - r, top: h / 2 - r, width: r * 2, height: r * 2 }}
      />
      {dot && (
        <span
          className="absolute size-3 rounded-full border-2 border-white"
          style={{ left: dot.x - 6, top: dot.y - 6, background: ok === false ? "#C82829" : "#14995A" }}
        />
      )}
    </span>
  );
}
