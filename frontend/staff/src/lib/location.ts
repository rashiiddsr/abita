/** Lokasi perangkat (Geolocation API) + jarak ke titik absensi. Server tetap memeriksa ulang. */
import { useCallback, useEffect, useState } from "react";
import type { Office } from "./types";

export type LocState = "checking" | "valid" | "weak" | "outside" | "permissionOff" | "error";
export type Fix = { lat: number; lng: number; accuracy: number; at: number };
export type LocResult = { state: LocState; fix: Fix | null; distance: number | null; message?: string };

const WEAK_ACCURACY_M = 80;
const ALLOWANCE_MAX_M = 100; // sama dengan GPS_ACCURACY_ALLOWANCE_MAX_M di server

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000;
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function evaluate(fix: Fix, office: Office | null): LocResult {
  if (!office) return { state: "error", fix, distance: null, message: "Kantor belum diatur admin." };
  const distance = haversine(fix.lat, fix.lng, office.lat, office.lng);
  if (distance - Math.min(fix.accuracy, ALLOWANCE_MAX_M) > office.radius_m) return { state: "outside", fix, distance };
  return { state: fix.accuracy > WEAK_ACCURACY_M ? "weak" : "valid", fix, distance };
}

function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(Object.assign(new Error("Perangkat tidak mendukung lokasi."), { code: 0 }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  });
}

// hasil terakhir dibagi antar-halaman (Beranda & alur presensi)
let shared: LocResult = { state: "checking", fix: null, distance: null };
const listeners = new Set<(r: LocResult) => void>();
const publish = (r: LocResult) => {
  shared = r;
  listeners.forEach((l) => l(r));
};

export async function refreshLocation(office: Office | null): Promise<LocResult> {
  publish({ ...shared, state: "checking" });
  try {
    const r = evaluate(await getFix(), office);
    publish(r);
    return r;
  } catch (e) {
    const err = e as GeolocationPositionError;
    const r: LocResult =
      err?.code === 1
        ? { state: "permissionOff", fix: null, distance: null, message: "Izinkan akses lokasi untuk situs ini di pengaturan browser." }
        : { state: "error", fix: null, distance: null, message: !window.isSecureContext ? "Lokasi butuh HTTPS atau localhost." : "Lokasi tidak tersedia. Coba di area terbuka." };
    publish(r);
    return r;
  }
}

export const isFresh = () => !!shared.fix && Date.now() - shared.fix.at < 60_000;

export function useLocation(office: Office | null) {
  const [r, setR] = useState<LocResult>(shared);
  useEffect(() => {
    listeners.add(setR);
    return () => {
      listeners.delete(setR);
    };
  }, []);
  const refresh = useCallback(() => refreshLocation(office), [office]);
  return { result: r, refresh };
}
