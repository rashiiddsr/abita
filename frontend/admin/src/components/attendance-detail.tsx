import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, MapPin, PencilLine, ScanFace, Timer } from "lucide-react";
import { useState } from "react";
import { api, apiUrl, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { duration, fmtDateLong, initials, todayWib, wibParts } from "@/lib/format";
import { DAY, tipe, toneStyle } from "@/lib/status";
import type { DailyDetail } from "@/lib/types";
import { MiniMap } from "./minimap";
import { useToast } from "./providers";
import { Button, Drawer, Empty, FormRow, GreyTag, Modal, ModalHead, Pill, SectionLabel, Skel, Tag, cx, inputCls, textareaCls } from "./ui";
import { diffLabel, inTimeColor, outTimeColor } from "@/lib/time-tone";

export function AttendanceDrawer({ userId, date, onClose }: { userId: number | null; date: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["daily-detail", userId, date],
    queryFn: () => api<DailyDetail>(`/api/v1/admin/daily/${userId}`, { query: { date } }),
    enabled: userId != null,
  });
  const d = q.data;
  const r = d?.row;
  const s = useSession();
  const [fix, setFix] = useState(false);
  // koreksi absensi: hanya Kepala Unit (unit karyawan), sampai hari ini; Admin SDM memantau
  const canFix = s.isHead && !!d && d.date <= todayWib();
  return (
    <>
      <Drawer open={userId != null} onClose={onClose} title="Detail absensi">
        {!d || !r ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3.5">
              <Skel className="size-[52px] rounded-lg" />
              <div className="flex flex-1 flex-col gap-2">
                <Skel className="h-4 w-2/3" />
                <Skel className="h-3 w-1/3" />
              </div>
            </div>
            <Skel className="h-24 rounded-xl" />
            <Skel className="h-24 rounded-xl" />
          </div>
        ) : (
          <>
            <DetailBody d={d} />
            {canFix && (
              <Button variant="outline" className="self-start" onClick={() => setFix(true)}>
                <PencilLine size={15} /> Koreksi absensi
              </Button>
            )}
          </>
        )}
      </Drawer>
      {fix && d && <CorrectModal d={d} onClose={() => setFix(false)} />}
    </>
  );
}

function DetailBody({ d }: { d: DailyDetail }) {
  const r = d.row;
  const S = DAY[r.status];
  const T = tipe(r.employment_type);
  const has = !!r.check_in || r.status === "gagal";
  const office = d.office;
  const late = r.late_minutes ?? 0;
  const times = [
    { label: "Check in", value: r.check_in ?? "—", icon: LogIn, c: inTimeColor(r.in_diff_min), sub: r.check_in ? diffLabel(r.in_diff_min) : null },
    { label: "Check out", value: r.check_out ?? "—", icon: LogOut, c: outTimeColor(r.out_diff_min), sub: r.check_out ? diffLabel(r.out_diff_min) : null },
    { label: "Durasi", value: duration(r.check_in, r.check_out), icon: Timer, c: undefined, sub: null },
  ];
  // riwayat: percobaan, catatan absensi, koreksi
  const timeline = [
    ...d.attempts.map((a) => ({
      t: a.time,
      title: a.success ? `${a.purpose === "out" ? "Check out" : a.purpose === "in" ? "Check in" : "Verifikasi"} ${a.time}` : `Percobaan gagal ${a.time}`,
      sub: a.success
        ? `Lokasi${a.distance_m != null ? ` ${Math.round(a.distance_m)} m dari titik` : ""} · wajah cocok${a.match_score != null ? ` ${(a.match_score * 100).toFixed(1)}%` : ""}`
        : a.message,
      c: a.success ? "#14995A" : "#C82829",
    })),
    ...d.logs.map((l) => ({
      t: wibParts(l.at).time,
      title: `Koreksi ${l.detail.type === "out" ? "check out" : "check in"}: ${l.detail.before ?? "—"} → ${l.detail.after}`,
      sub: `${l.actor ?? "Admin"} · ${wibParts(l.at).time} · ${l.detail.reason ?? ""}`,
      c: "#4F5BD5",
    })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  const note =
    r.status === "izin" || r.status === "sakit"
      ? `${S.label} · pengajuan disetujui untuk tanggal ini.`
      : r.status === "belum"
        ? "Belum check in. Shift sudah dimulai, cek izin atau hubungi unit."
        : r.status === "alpa"
          ? "Tidak ada check in dan tidak ada pengajuan untuk tanggal ini."
          : r.status === "tanpa_pulang"
            ? "Check in tercatat, tetapi tidak ada check out sampai batas waktu. Bila karyawan benar bekerja sampai selesai, isi jam pulang lewat Koreksi absensi."
            : null;
  return (
    <>
      <div className="flex items-center gap-3.5">
        <span className="flex size-[52px] flex-none items-center justify-center rounded-lg text-base font-semibold" style={toneStyle(T.bg, T.fg)}>
          {initials(r.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[17px] font-semibold">{r.name}</span>
          <span className="text-[12.5px] font-medium text-muted">NIK {r.employee_code}</span>
        </div>
        <Pill tone={S}>{r.status === "telat" ? `Terlambat ${late} mnt` : S.label}</Pill>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Tag tone={T} className="px-2.5 py-1 text-xs" />
        {r.unit && <GreyTag>{r.unit}</GreyTag>}
        <GreyTag>{r.shift ? `Shift ${r.shift.name} · ${r.shift.start}–${r.shift.end}` : "Tanpa jadwal"}</GreyTag>
        <GreyTag>{fmtDateLong(d.date)}</GreyTag>
      </div>
      <div className="grid grid-cols-3 rounded-xl bg-soft">
        {times.map((t, i) => (
          <div key={t.label} className={cx("flex flex-col gap-2 p-3", i && "border-l border-line")}>
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-card text-brand">
              <t.icon size={16} strokeWidth={2.2} />
            </span>
            <div className="flex flex-col gap-px">
              <span className="text-xs font-medium text-muted">{t.label}</span>
              <span className="tnum text-[17px] font-semibold" style={{ color: t.c ?? "var(--color-ink)" }}>
                {t.value}
                {t.sub && <span className="ml-1 text-[11px] font-semibold">{t.sub}</span>}
              </span>
            </div>
          </div>
        ))}
      </div>

      {has && (
        <>
          <SectionLabel>LOKASI</SectionLabel>
          <div className="flex items-center gap-3.5 rounded-xl p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
            {office ? (
              <MiniMap center={office} radiusM={office.radius_m} point={r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null} ok={r.location_ok !== false} w={76} h={76} />
            ) : (
              <span className="flex size-[76px] items-center justify-center rounded-lg bg-soft text-faint">
                <MapPin />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-medium">{office?.name ?? "Lokasi presensi"}</span>
              <span className="text-[12.5px] font-normal leading-[1.4] text-muted">
                {r.manual && r.location_ok
                  ? "Dikoreksi manual oleh Kepala Unit"
                  : r.distance_m != null
                    ? `${Math.round(r.distance_m)} m dari titik · akurasi GPS ±${Math.round(r.accuracy ?? 0)} m`
                    : (r.location_note ?? "—")}
              </span>
              <span
                className={cx(
                  "inline-flex items-center gap-[5px] self-start rounded-full px-[9px] py-[3px] text-[11.5px] font-medium",
                  r.location_ok === false ? "bg-bad-bg text-bad" : "bg-ok-bg text-ok",
                )}
              >
                <MapPin size={12} strokeWidth={2.4} />
                {r.location_ok === false ? (r.location_note ?? "Lokasi tidak valid") : "Di dalam area"}
              </span>
            </div>
          </div>
          <SectionLabel>WAJAH</SectionLabel>
          <div className="flex items-center gap-3.5 rounded-xl p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
            {r.has_photo && (r.out_id ?? r.in_id) ? (
              <img src={apiUrl(`/api/v1/admin/attendance/${r.out_id ?? r.in_id}/photo`)} alt="Foto verifikasi" className="size-11 flex-none rounded-lg object-cover" />
            ) : (
              <span className={cx("flex size-11 flex-none items-center justify-center rounded-lg", r.face_ok === false ? "bg-bad-bg text-bad" : "bg-ok-bg text-ok")}>
                <ScanFace size={22} />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {r.face_ok === false ? "Wajah tidak sesuai" : r.face_ok == null ? "Wajah belum diperiksa" : r.manual ? "Tanpa verifikasi wajah" : "Wajah sesuai data terdaftar"}
              </span>
              <span className={cx("text-[12.5px] font-medium", r.face_ok === false ? "text-bad" : "text-ok")}>
                {r.face_note ?? (r.match_score != null ? `Skor kecocokan ${(r.match_score * 100).toFixed(1).replace(".", ",")}% · liveness lolos` : "—")}
              </span>
            </div>
          </div>
        </>
      )}

      {note && (
        <div className="rounded-xl p-3.5 text-[13.5px] font-medium leading-normal" style={toneStyle(DAY[r.status].bg, DAY[r.status].fg)}>
          {note}
        </div>
      )}

      <SectionLabel>RIWAYAT</SectionLabel>
      {timeline.length === 0 ? (
        <Empty compact />
      ) : (
        <div className="flex flex-col">
          {timeline.map((e, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex w-3.5 flex-none flex-col items-center">
                <span className="mt-1 size-3 flex-none rounded-full" style={{ background: e.c }} />
                <span className="min-h-[18px] w-0.5 flex-1 bg-line" style={{ opacity: i < timeline.length - 1 ? 1 : 0 }} />
              </div>
              <div className="flex flex-1 flex-col gap-0.5 pb-3.5">
                <span className="text-sm font-medium">{e.title}</span>
                <span className="text-[12.5px] font-normal leading-[1.4] text-muted">{e.sub}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Ubah / isi jam check in & check out satu tanggal (Kepala Unit), dengan alasan yang dikirim ke karyawan. */
function CorrectModal({ d, onClose }: { d: DailyDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const r = d.row;
  const [f, setF] = useState({ in: r.check_in ?? "", out: r.check_out ?? "", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api<DailyDetail>("/api/v1/admin/attendance/correct", {
        body: {
          user_id: r.user_id,
          date: d.date,
          // hanya jam yang diubah yang dikirim
          check_in: f.in && f.in !== r.check_in ? f.in : null,
          check_out: f.out && f.out !== r.check_out ? f.out : null,
          reason: f.reason.trim(),
        },
      }),
    onSuccess: (res) => {
      qc.setQueryData(["daily-detail", r.user_id, d.date], res);
      for (const k of ["daily", "attendance-summary", "staff-detail", "dashboard"]) qc.invalidateQueries({ queryKey: [k] });
      toast(`Absensi ${r.name} dikoreksi · karyawan diberi tahu`);
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (!f.in && !f.out) return setErr("Isi jam check in atau check out.");
    if (f.out && !f.in) return setErr("Isi jam check in terlebih dahulu.");
    if (f.in === (r.check_in ?? "") && f.out === (r.check_out ?? "")) return setErr("Belum ada jam yang diubah.");
    if (f.reason.trim().length < 5) return setErr("Tulis alasan koreksi (minimal 5 karakter).");
    setErr(null);
    m.mutate();
  }
  const night = !!f.in && !!f.out && f.out <= f.in;
  return (
    <Modal open onClose={onClose} width={440} top={90}>
      <ModalHead title="Koreksi absensi" sub={`${r.name} · ${fmtDateLong(d.date)}${r.shift ? ` · Shift ${r.shift.name} ${r.shift.start}–${r.shift.end}` : ""}`} onClose={onClose} />
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Check in">
          <input type="time" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} className={inputCls} />
        </FormRow>
        <FormRow label="Check out">
          <input type="time" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} className={inputCls} />
        </FormRow>
      </div>
      {night && <span className="-mt-2 text-xs text-muted">Check out dicatat keesokan harinya (lewat tengah malam).</span>}
      <FormRow label="Alasan koreksi" required>
        <textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Contoh: Lupa check out, sudah dikonfirmasi rekan shift" className={textareaCls} />
      </FormRow>
      <span className="text-xs text-muted">Dicatat sebagai koreksi manual, masuk riwayat, dan alasannya dikirim ke karyawan.</span>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} onClick={submit}>
          Simpan koreksi
        </Button>
      </div>
    </Modal>
  );
}
