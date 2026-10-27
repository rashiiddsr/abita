import { useSyncExternalStore } from "react";
import { THEME_KEY as KEY } from "./theme-boot";

// Tema dasbor: "system" mengikuti OS; "light"/"dark" dipaksa lewat atribut data-theme di <html>.
export type ThemePref = "system" | "light" | "dark";
const EVENT = "presensi-theme";

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(t: ThemePref) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {}
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    read,
    () => "system",
  );
}
