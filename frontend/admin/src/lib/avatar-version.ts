import { useSyncExternalStore } from "react";

// Versi foto profil: dinaikkan setelah unggah/hapus agar <img> memuat ulang (URL sama, isi berubah).
let version = 0;
const subs = new Set<() => void>();

export function bumpAvatar() {
  version += 1;
  subs.forEach((f) => f());
}

export function useAvatarVersion() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => version,
    () => 0,
  );
}
