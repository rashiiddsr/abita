import { hoursSince } from "./format";
import type { LeaveOut } from "./types";

/** Penanggung jawab pengajuan: selalu Kepala Unit dari unit karyawan (satu tahap). */
export function reviewerLine(r: LeaveOut, headOf: (u: string | null) => string | null) {
  if (r.status !== "pending") return { name: r.reviewer_name ?? "—", role: "Kepala Unit" };
  const head = headOf(r.unit);
  return head ? { name: head, role: "Kepala Unit" } : { name: "—", role: r.unit ?? "" };
}

export function flagOf(r: LeaveOut) {
  if (r.status !== "pending" || hoursSince(r.created_at) < 24) return null;
  return { text: `Menunggu ${Math.floor(hoursSince(r.created_at))} jam`, c: "#8A5600", bg: "#FFF3D9" };
}
