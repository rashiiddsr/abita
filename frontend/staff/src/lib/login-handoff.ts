/**
 * Kata sandi yang baru dipakai masuk, diteruskan ke halaman "Buat kata sandi baru" agar tidak diketik ulang.
 * Hanya di memori (hilang saat muat ulang), kedaluwarsa 10 menit, dihapus setelah kata sandi diganti / keluar.
 */
const TTL_MS = 10 * 60_000;
let held: { pw: string; at: number } | null = null;

export function holdLoginPassword(pw: string) {
  held = { pw, at: Date.now() };
}

/** Dibaca tanpa menghapus (StrictMode memanggil inisialisasi state dua kali). */
export function heldLoginPassword(): string {
  if (held && Date.now() - held.at > TTL_MS) held = null;
  return held?.pw ?? "";
}

export function clearLoginPassword() {
  held = null;
}
