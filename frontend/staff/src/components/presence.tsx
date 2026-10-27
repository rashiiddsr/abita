/** Peta lokasi presensi (tile statis, tanpa library) dan tampilan kamera verifikasi wajah. */
import { Building2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CHALLENGE_TEXT } from "../lib/face/challenge";
import type { useVerifier } from "../lib/face/useVerifier";
import { fmtDistance } from "../lib/format";
import type { Fix } from "../lib/location";
import type { Office } from "../lib/types";
import { cx } from "./ui";

// ------------------------------------------------------------------ peta

const TILE = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
function project(lat: number, lon: number, z: number) {
  const n = 2 ** z * 256;
  const lr = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n };
}
const mpp = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Peta kantor + radius + titik pengguna; zoom dipilih agar keduanya terlihat. */
export function LocationMap({ office, fix, outside, distance }: { office: Office; fix: Fix | null; outside: boolean; distance: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w, h } = size;
  // pusat di tengah kantor & pengguna, zoom maksimum yang memuat radius dan titik pengguna
  const cLat = fix ? (office.lat + fix.lat) / 2 : office.lat;
  const cLng = fix ? (office.lng + fix.lng) / 2 : office.lng;
  let z = 18;
  if (w && h) {
    for (; z > 3; z--) {
      const a = project(office.lat, office.lng, z);
      const b = fix ? project(fix.lat, fix.lng, z) : a;
      const r = office.radius_m / mpp(office.lat, z);
      const spanX = Math.abs(a.x - b.x) + 2 * r + 80;
      const spanY = Math.abs(a.y - b.y) + 2 * r + 120;
      if (spanX < w && spanY < h) break;
    }
  }
  const c = project(cLat, cLng, z);
  const ox = c.x - w / 2,
    oy = c.y - h / 2;
  const tiles: { url: string; left: number; top: number }[] = [];
  if (w && h) for (let tx = Math.floor(ox / 256); tx * 256 < ox + w; tx++) for (let ty = Math.floor(oy / 256); ty * 256 < oy + h; ty++) tiles.push({ url: TILE(z, tx, ty), left: tx * 256 - ox, top: ty * 256 - oy });
  const o = project(office.lat, office.lng, z);
  const op = { x: o.x - ox, y: o.y - oy };
  const r = office.radius_m / mpp(office.lat, z);
  const up = fix ? (() => { const p = project(fix.lat, fix.lng, z); return { x: p.x - ox, y: p.y - oy }; })() : null; // prettier-ignore
  const ring = outside ? "var(--danger)" : "var(--brand)";
  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden bg-[#E9ECE6]">
      {tiles.map((t) => (
        <img key={t.url} src={t.url} alt="" draggable={false} className="absolute max-w-none select-none" style={{ left: t.left, top: t.top, width: 256, height: 256, filter: "saturate(.45) brightness(1.04)" }} />
      ))}
      {w > 0 && (
        <svg className="absolute inset-0" width={w} height={h}>
          <circle cx={op.x} cy={op.y} r={r} fill={ring} fillOpacity={0.12} stroke={ring} strokeWidth={2} />
          {up && <line x1={op.x} y1={op.y} x2={up.x} y2={up.y} stroke="#0F172A" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="6 5" />}
        </svg>
      )}
      {w > 0 && (
        <span className="absolute flex flex-col items-center" style={{ left: op.x - 19, top: op.y - 46 }}>
          <span className="flex size-[38px] items-center justify-center rounded-full border-[2.5px] border-white bg-[#0F172A] text-white shadow-md">
            <Building2 size={18} />
          </span>
          <span className="-mt-px border-x-[5px] border-t-[8px] border-x-transparent border-t-[#0F172A]" />
        </span>
      )}
      {up && (
        <span className="absolute flex items-center gap-1" style={{ left: up.x - 9, top: up.y - 9 }}>
          <span className="size-[18px] rounded-full border-[3px] border-white bg-cyan shadow-[0_0_0_6px_rgba(3,177,192,.25)]" />
          <span className="rounded-full bg-[#0F172A] px-2 py-0.5 text-[11px] font-extrabold text-white">{fmtDistance(distance)}</span>
        </span>
      )}
      <span className="absolute bottom-1.5 left-2 text-[10px] text-[#5B6678]">© Esri</span>
    </div>
  );
}

// ------------------------------------------------------------------ kamera

type V = ReturnType<typeof useVerifier>;

/** Kotak kamera gelap: sudut bingkai cyan, oval panduan, garis pindai, instruksi gerakan saat berjalan. */
export function FaceCamera({ v, className }: { v: V; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (el && v.video && v.video.parentElement !== el) el.appendChild(v.video);
  }, [v.video]);
  const running = v.stage === "running";
  const busy = v.stage === "starting" || v.stage === "preparing" || v.stage === "submitting";
  const tone = running && v.hint ? "#FBBF24" : "#5FE3EE";
  return (
    <div className={cx("relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle,#1C2B36,#0B1418)]", className)}>
      <div ref={host} className="absolute inset-0" />
      {!v.video && !v.cameraError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-[118px] w-[92px] rounded-[60px] bg-[#3A4752]" />
        </div>
      )}
      {/* bingkai */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[
          "M8 22 V10 Q8 8 10 8 H22",
          "M78 8 H90 Q92 8 92 10 V22",
          "M92 78 V90 Q92 92 90 92 H78",
          "M22 92 H10 Q8 92 8 90 V78",
        ].map((d) => (
          <path key={d} d={d} fill="none" stroke={tone} strokeWidth="1.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 4 }} />
        ))}
      </svg>
      <div className="pointer-events-none absolute left-1/2 top-[46%] h-[62%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2" style={{ borderColor: tone, borderStyle: running ? "solid" : "dashed", opacity: 0.85 }} />
      {!running && !busy && v.stage !== "failed" && <span className="animate-scan pointer-events-none absolute inset-x-[12%] h-[2px] bg-gradient-to-r from-transparent via-[#5FE3EE] to-transparent" />}
      <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold text-white">
        <span className={cx("size-2 rounded-full", v.video ? "bg-[#ef4444]" : "bg-white/50")} /> LIVE
      </span>
      {running && v.challenge && (
        <div className="absolute inset-x-3 top-12 flex flex-col items-center gap-2">
          <span className="rounded-full bg-black/55 px-4 py-2 text-center text-[16px] font-bold text-white">{CHALLENGE_TEXT[v.challenge]}</span>
          <span className="flex gap-1.5">
            {Array.from({ length: v.total }, (_, i) => (
              <span key={i} className={cx("h-1.5 w-7 rounded-full", i < v.step ? "bg-[#5FE3EE]" : i === v.step ? "bg-white" : "bg-white/30")} />
            ))}
          </span>
        </div>
      )}
      {running && (
        <div className="absolute inset-x-3 bottom-3 flex flex-col items-center gap-2">
          {v.hint && <span className="rounded-full bg-[#FBBF24] px-3.5 py-1.5 text-[13px] font-bold text-[#3B2A00]">{v.hint}</span>}
          <span className="h-1 w-40 overflow-hidden rounded-full bg-white/25">
            <span className="block h-full rounded-full bg-white transition-[width] duration-200" style={{ width: `${Math.round((v.remaining / 10_000) * 100)}%` }} />
          </span>
        </div>
      )}
      {busy && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45 text-white">
          <Loader2 size={30} className="animate-spin" />
          <span className="text-[14px] font-semibold">{v.stage === "submitting" ? "Memverifikasi wajah…" : v.stage === "preparing" ? "Memulai verifikasi…" : "Menyalakan kamera…"}</span>
        </div>
      )}
    </div>
  );
}
