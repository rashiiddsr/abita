import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, Clock3, LifeBuoy, Repeat, LocateFixed, Mail, MapPin, PencilLine, Plus, Send, Trash2 } from "lucide-react";
import { useSearchParams } from "@/lib/nav";
import { Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { MiniMap } from "@/components/minimap";
import { useToast } from "@/components/providers";
import { RowMenu } from "@/components/row-menu";
import { Page } from "@/components/shell";
import { ConfirmModal, PhoneInput, validEmail, validPhone } from "@/components/staff-form";
import { Button, Card, Empty, FormRow, Modal, ModalHead, PageHeader, Select, Skel, Toggle, cx, inputCls, ErrorState } from "@/components/ui";
import { ApiError, api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { SHIFT_COLORS, shiftTone } from "@/lib/status";
import type { SettingsSection } from "@/lib/access";
import { SequenceChips, SequenceEditor } from "@/components/sequence-editor";
import { fmtDateLong } from "@/lib/format";
import type { AppSettings, Holiday, HolidayKind, KuNotifPrefs, Office, SchedulePattern, ShiftType, SmtpConfig } from "@/lib/types";

export const Route = createFileRoute("/_app/settings")({ component: PengaturanPage });

// Admin SDM: lokasi, jam shift (+ aturan absen), pola global, hari libur, kontak bantuan, SMTP · Kepala Unit: pola unit, notifikasi (lib/access.ts)
type Sec = SettingsSection;
const SECS: { k: Sec; l: string; i: typeof MapPin }[] = [
  { k: "lokasi", l: "Lokasi presensi", i: MapPin },
  { k: "shift", l: "Jam shift", i: Clock3 },
  { k: "pola", l: "Pola jadwal", i: Repeat },
  { k: "libur", l: "Hari libur", i: CalendarDays },
  { k: "bantuan", l: "Kontak bantuan", i: LifeBuoy },
  { k: "smtp", l: "Konfigurasi SMTP", i: Mail },
  { k: "notif", l: "Notifikasi", i: Bell },
];
const RADIUS_MAX = 1000;
/** Titik awal saat lokasi presensi belum pernah disimpan (Batam); geser lewat "Pakai lokasi saya" atau isi koordinat. */
const DEFAULT_POINT = { lat: 1.1301, lng: 104.0529 };

function PengaturanPage() {
  return (
    <Suspense fallback={<Page><Skel className="h-96 rounded-xl" /></Page>}>
      <SettingsFromUrl />
    </Suspense>
  );
}

// ?sec=smtp dsb. (dari menu akun & pencarian global) membuka bagian yang dituju
function SettingsFromUrl() {
  const sp = useSearchParams();
  const sec = sp.get("sec");
  return <Settings key={sec ?? ""} initial={sec} />;
}

function Settings({ initial }: { initial: string | null }) {
  const s = useSession();
  const secs = SECS.filter((x) => s.can.settings.includes(x.k));
  const [sec, setSec] = useState<Sec>(secs.find((x) => x.k === initial)?.k ?? secs[0]?.k ?? "lokasi");
  return (
    <Page>
      <PageHeader title="Pengaturan" />
      <div className="grid items-start gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="no-scrollbar flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col">
          {secs.map((n) => (
            <button
              key={n.k}
              onClick={() => setSec(n.k)}
              className={cx(
                "flex h-9 flex-none items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-left text-[13.5px] font-medium",
                sec === n.k ? "bg-card text-ink shadow-card ring-1 ring-line" : "text-muted hover:bg-card hover:text-ink",
              )}
            >
              <n.i size={16} />
              {n.l}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          {sec === "lokasi" && <LocationSection />}
          {sec === "shift" && <ShiftSection />}
          {sec === "pola" && <PatternSection />}
          {sec === "libur" && <HolidaySection />}
          {sec === "bantuan" && <HelpdeskSection />}
          {sec === "smtp" && <SmtpSection />}
          {sec === "notif" && <NotifSection />}
        </div>
      </div>
    </Page>
  );
}

type RuleKey = "checkin_open_before_min" | "checkin_close_after_min" | "checkout_open_before_min" | "checkout_close_after_min";
const RULES: { key: RuleKey; title: string; max: number }[] = [
  { key: "checkin_open_before_min", title: "Check in dibuka sebelum jam mulai", max: 360 },
  { key: "checkin_close_after_min", title: "Check in ditutup setelah jam mulai", max: 360 },
  { key: "checkout_open_before_min", title: "Check out dibuka sebelum jam selesai", max: 360 },
  { key: "checkout_close_after_min", title: "Check out ditutup setelah jam selesai", max: 720 },
];

function SecCard({ title, action, children, flush }: { title: string; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <Card enterScope>
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-5 py-2.5">
        <span className="text-[15px] font-semibold">{title}</span>
        {action}
      </div>
      <div className={flush ? "" : "px-5 py-4"}>{children}</div>
    </Card>
  );
}

function Row({ title, children, first }: { title: string; children?: ReactNode; first?: boolean }) {
  return (
    <div className={cx("flex items-center gap-4 py-3", !first && "border-t border-line2")}>
      <span className="min-w-0 flex-1 text-[13.5px] font-medium">{title}</span>
      {children}
    </div>
  );
}

/** Tombol simpan tetap di bawah tiap bagian pengaturan (aktif bila ada perubahan). */
function SaveBar({ dirty, saving, onSave }: { dirty: boolean; saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end">
      <Button data-submit onClick={onSave} loading={saving} disabled={!dirty}>
        Simpan Perubahan
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ lokasi

/** Lebar elemen (callback ref: elemen baru muncul setelah data dimuat). */
function useWidth() {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.current.observe(el);
  }, []);
  return { ref, w };
}

function LocationSection() {
  const qc = useQueryClient();
  const toast = useToast();
  // 404 = belum ada lokasi (database baru): tampilkan formulir dengan titik awal, bukan memuat terus
  const office = useQuery({
    queryKey: ["office"],
    queryFn: () => api<Office>("/api/v1/admin/office"),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const missing = office.error instanceof ApiError && office.error.status === 404;
  // form = data server sampai ada perubahan lokal
  const [edits, setF] = useState<{ name: string; address: string; lat: string; lng: string; radius: number } | null>(null);
  const o = office.data;
  const f =
    edits ??
    (o
      ? { name: o.name, address: o.address ?? "", lat: o.lat.toFixed(6), lng: o.lng.toFixed(6), radius: Math.min(RADIUS_MAX, Math.round(o.radius_m)) }
      : missing
        ? { name: "RS Awal Bros Botania", address: "", lat: DEFAULT_POINT.lat.toFixed(6), lng: DEFAULT_POINT.lng.toFixed(6), radius: 100 }
        : null);
  const [locating, setLocating] = useState(false);
  const { ref, w } = useWidth();
  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/admin/office", { method: "PUT", body: { name: f!.name.trim(), address: f!.address.trim() || null, lat: Number(f!.lat), lng: Number(f!.lng), radius_m: f!.radius } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["office"] });
      setF(null);
      toast("Lokasi presensi disimpan");
    },
    onError: (e) => toast(errMsg(e)),
  });
  if (office.isError && !missing) return <ErrorState message={(office.error as Error).message} onRetry={() => office.refetch()} />;
  if (!f) return <Skel className="h-[520px] rounded-xl" />;
  const lat = Number(f.lat);
  const lng = Number(f.lng);
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && f.name.trim().length > 0;
  const dirty =
    !o ||
    f.name !== o.name || f.address !== (o.address ?? "") || lat.toFixed(6) !== o.lat.toFixed(6) || lng.toFixed(6) !== o.lng.toFixed(6) || f.radius !== Math.round(o.radius_m);
  // zoom peta mengikuti radius agar lingkaran tetap terlihat utuh
  const zoom = f.radius > 600 ? 14 : f.radius > 250 ? 15 : 16;
  function useMine() {
    if (!navigator.geolocation) return toast("Browser tidak mendukung lokasi");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setF((x) => ({ ...(x ?? f!), lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }));
        toast(`Lokasi didapat (±${Math.round(p.coords.accuracy)} m)`);
      },
      () => {
        setLocating(false);
        toast("Izin lokasi ditolak atau sinyal tidak tersedia");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  return (
    <>
      <SecCard
        title="Lokasi presensi"
        action={
          <Button size="sm" loading={locating} onClick={useMine}>
            <LocateFixed size={14} /> Pakai lokasi saya
          </Button>
        }
      >
        <div ref={ref} className="relative h-[300px] overflow-hidden rounded-lg border border-line bg-[#EEF0EC]">
          {w > 0 && valid && <MiniMap center={{ lat, lng }} radiusM={f.radius} w={w} h={300} zoom={zoom} rounded={8} />}
          <span className="pointer-events-none absolute left-1/2 top-1/2 -ml-3.5 -mt-[26px] text-bad">
            <MapPin size={28} fill="#C82829" stroke="#FFFFFF" strokeWidth={1.5} />
          </span>
          <span className="absolute bottom-1.5 right-2 text-[10px] text-muted">© Esri</span>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex justify-between">
            <span className="text-[13px] font-medium">Radius</span>
            <span className="tnum text-[13px] font-semibold text-brand">{f.radius} m</span>
          </div>
          <input type="range" min={50} max={RADIUS_MAX} step={10} value={f.radius} onChange={(e) => setF({ ...f, radius: Number(e.target.value) })} className="w-full accent-brand" />
          <div className="flex justify-between text-xs text-faint">
            <span>50 m</span>
            <span>{RADIUS_MAX} m</span>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormRow label="Nama lokasi">
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} />
          </FormRow>
          <FormRow label="Alamat">
            <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} className={inputCls} />
          </FormRow>
          <FormRow label="Latitude">
            <input value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} className={cx(inputCls, "tnum")} />
          </FormRow>
          <FormRow label="Longitude">
            <input value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} className={cx(inputCls, "tnum")} />
          </FormRow>
        </div>
      </SecCard>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => (valid ? save.mutate() : toast("Periksa nama dan koordinat"))} />
    </>
  );
}

// ------------------------------------------------------------------ shift (CRUD)

function ShiftSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const types = useQuery({ queryKey: ["shift-types"], queryFn: () => api<ShiftType[]>("/api/v1/admin/shift-types") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/v1/admin/settings") });
  const [form, setForm] = useState<{ t: ShiftType | null } | null>(null);
  const [del, setDel] = useState<ShiftType | null>(null);
  // aturan absen: toleransi terlambat + jendela check in / check out (menit); null = belum diubah
  const [rules, setRules] = useState<Partial<Record<RuleKey, number>>>({});
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shift-types"] });
    qc.invalidateQueries({ queryKey: ["shifts"] });
  };
  const toggle = useMutation({
    mutationFn: (t: ShiftType) =>
      api(`/api/v1/admin/shift-types/${t.id}`, { method: "PUT", body: { name: t.name, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5), color: t.color, active: !t.active } }),
    onSuccess: (_d, t) => {
      invalidate();
      toast(`Shift ${t.name} ${t.active ? "dinonaktifkan" : "diaktifkan"}`);
    },
    onError: (e) => toast(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (t: ShiftType) => api(`/api/v1/admin/shift-types/${t.id}`, { method: "DELETE" }),
    onSuccess: (_d, t) => {
      invalidate();
      toast(`Shift ${t.name} dihapus`);
      setDel(null);
    },
    onError: (e) => {
      toast(errMsg(e));
      setDel(null);
    },
  });
  const saveRules = useMutation({
    mutationFn: () => api<AppSettings>("/api/v1/admin/settings", { method: "PUT", body: rules }),
    onSuccess: (v) => {
      qc.setQueryData(["settings"], v);
      setRules({});
      toast("Aturan absen disimpan");
    },
    onError: (e) => toast(errMsg(e)),
  });
  if (!types.data || !settings.data) return <Skel className="h-80 rounded-xl" />;
  const list = [...types.data].sort((a, b) => Number(b.active) - Number(a.active) || a.start_time.localeCompare(b.start_time));
  return (
    <>
      <SecCard
        title="Jam shift"
        flush
        action={
          <Button size="sm" onClick={() => setForm({ t: null })}>
            <Plus size={14} /> Tambah shift
          </Button>
        }
      >
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_72px_48px] gap-3 border-b border-line bg-soft/60 px-5 py-2 text-xs font-medium text-muted">
          <span>Nama</span>
          <span>Jam</span>
          <span>Aktif</span>
          <span />
        </div>
        {list.map((t) => {
          const tone = shiftTone(t.name, t.color);
          const overnight = t.end_time <= t.start_time;
          return (
            <div key={t.id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_72px_48px] items-center gap-3 border-b border-line2 px-5 py-2.5 last:border-0">
              <span className={cx("flex min-w-0 items-center gap-2.5", !t.active && "opacity-50")}>
                <span className="size-2.5 flex-none rounded-full" style={{ background: tone.fg }} />
                <span className="truncate text-[13.5px] font-medium">{t.name}</span>
              </span>
              <span className={cx("tnum text-[13px] text-muted", !t.active && "opacity-50")}>
                {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                {overnight && <span className="ml-1.5 text-xs text-faint">+1 hari</span>}
              </span>
              <Toggle on={t.active} disabled={toggle.isPending} onChange={() => toggle.mutate(t)} label={`Shift ${t.name} aktif`} />
              <RowMenu
                actions={[
                  { label: "Ubah", icon: <PencilLine size={15} />, onClick: () => setForm({ t }) },
                  { label: "Hapus", icon: <Trash2 size={15} />, danger: true, onClick: () => setDel(t) },
                ]}
              />
            </div>
          );
        })}
        {list.length === 0 && <Empty compact />}
      </SecCard>
      <SecCard title="Aturan absen">
        {RULES.map((r, i) => (
          <Row key={r.key} title={r.title} first={i === 0}>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={r.max}
                value={rules[r.key] ?? settings.data[r.key]}
                onChange={(e) => setRules({ ...rules, [r.key]: Math.max(0, Math.min(r.max, Math.round(Number(e.target.value) || 0))) })}
                className={cx(inputCls, "tnum h-9 w-[72px] text-center")}
              />
              <span className="w-10 text-xs text-muted">menit</span>
            </span>
          </Row>
        ))}
        <div className="mt-2">
          <SaveBar dirty={RULES.some((r) => rules[r.key] !== undefined && rules[r.key] !== settings.data[r.key])} saving={saveRules.isPending} onSave={() => saveRules.mutate()} />
        </div>
      </SecCard>
      {form && <ShiftForm t={form.t} used={(types.data ?? []).map((x) => x.color)} onClose={() => setForm(null)} onSaved={invalidate} />}
      {del && (
        <ConfirmModal
          title={`Hapus shift ${del.name}?`}
          body="Shift yang sudah dipakai di jadwal atau riwayat presensi tidak bisa dihapus; nonaktifkan saja."
          confirm="Hapus shift"
          danger
          loading={remove.isPending}
          onConfirm={() => remove.mutate(del)}
          onClose={() => setDel(null)}
        />
      )}
    </>
  );
}

function ShiftForm({ t, used, onClose, onSaved }: { t: ShiftType | null; used: (string | null)[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: t?.name ?? "",
    start: t?.start_time.slice(0, 5) ?? "08:00",
    end: t?.end_time.slice(0, 5) ?? "16:00",
    color: t?.color ?? SHIFT_COLORS.find((c) => !used.includes(c)) ?? SHIFT_COLORS[0],
    active: t?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), start_time: f.start, end_time: f.end, color: f.color, active: f.active };
      return t ? api(`/api/v1/admin/shift-types/${t.id}`, { method: "PUT", body }) : api("/api/v1/admin/shift-types", { body });
    },
    onSuccess: () => {
      onSaved();
      toast(t ? "Shift disimpan" : "Shift ditambahkan");
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (f.name.trim().length < 2) return setErr("Nama shift minimal 2 huruf.");
    if (f.start === f.end) return setErr("Jam mulai dan selesai tidak boleh sama.");
    setErr(null);
    m.mutate();
  }
  return (
    <Modal open onClose={onClose} width={440}>
      <ModalHead title={t ? "Ubah shift" : "Tambah shift"} onClose={onClose} />
      <FormRow label="Nama shift" required>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Contoh: Middle" className={inputCls} />
      </FormRow>
      <div className="grid grid-cols-2 gap-4">
        <FormRow label="Mulai" required>
          <input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={cx(inputCls, "tnum")} />
        </FormRow>
        <FormRow label={f.end <= f.start ? "Selesai (+1 hari)" : "Selesai"} required>
          <input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={cx(inputCls, "tnum")} />
        </FormRow>
      </div>
      <FormRow label="Warna">
        <div className="flex flex-wrap gap-2">
          {SHIFT_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Warna ${c}`}
              onClick={() => setF({ ...f, color: c })}
              className={cx("size-7 rounded-full ring-offset-2", f.color === c && "ring-2 ring-ink")}
              style={{ background: c }}
            />
          ))}
        </div>
      </FormRow>
      <Row title="Aktif" first>
        <Toggle on={f.active} onChange={(v) => setF({ ...f, active: v })} label="Aktif" />
      </Row>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} onClick={submit}>
          {t ? "Simpan" : "Tambah shift"}
        </Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ aturan

function HelpdeskSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/v1/admin/settings") });
  const [edits, setF] = useState<AppSettings | null>(null);
  const f = edits ?? settings.data ?? null;
  const [err, setErr] = useState<{ email?: string; wa?: string }>({});
  const save = useMutation({
    mutationFn: () => api<AppSettings>("/api/v1/admin/settings", { method: "PUT", body: { ...f, helpdesk_whatsapp: wa ? `62${wa}` : "" } }),
    onSuccess: (v) => {
      qc.setQueryData(["settings"], v);
      setF(null);
      toast("Kontak bantuan disimpan");
    },
    onError: (e) => toast(errMsg(e)),
  });
  if (!f || !settings.data) return <Skel className="h-48 rounded-xl" />;
  // disimpan sebagai 62812…; di form hanya digit setelah +62
  const wa = f.helpdesk_whatsapp.replace(/\D/g, "").replace(/^62/, "").replace(/^0/, "");
  const dirty = JSON.stringify(f) !== JSON.stringify(settings.data);
  function submit() {
    const e = { email: validEmail(f!.helpdesk_email) ? undefined : "Email tidak valid", wa: validPhone(wa) ? undefined : "Nomor tidak valid" };
    setErr(e);
    if (!e.email && !e.wa) save.mutate();
  }
  return (
    <SecCard title="Kontak bantuan">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Email" required error={err.email}>
          <input type="email" value={f.helpdesk_email} onChange={(e) => setF({ ...f, helpdesk_email: e.target.value })} placeholder="sdm@awalbros.cc" className={inputCls} />
        </FormRow>
        <FormRow label="WhatsApp" required error={err.wa}>
          <PhoneInput value={wa} onChange={(v) => setF({ ...f, helpdesk_whatsapp: v })} invalid={!!err.wa} />
        </FormRow>
      </div>
      <div className="mt-4">
        <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} />
      </div>
    </SecCard>
  );
}

// ------------------------------------------------------------------ pola jadwal (master schedule)

function PatternSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const types = useQuery({ queryKey: ["shift-types"], queryFn: () => api<ShiftType[]>("/api/v1/admin/shift-types") });
  const list = useQuery({ queryKey: ["patterns"], queryFn: () => api<SchedulePattern[]>("/api/v1/admin/patterns") });
  const [form, setForm] = useState<{ p: SchedulePattern | null } | null>(null);
  const [del, setDel] = useState<SchedulePattern | null>(null);
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["patterns"] });
    toast(msg);
  };
  const toggle = useMutation({
    mutationFn: (p: SchedulePattern) => api(`/api/v1/admin/patterns/${p.id}`, { method: "PUT", body: { name: p.name, sequence: p.sequence, active: !p.active } }),
    onSuccess: () => done("Pola disimpan"),
    onError: (e) => toast(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (p: SchedulePattern) => api(`/api/v1/admin/patterns/${p.id}`, { method: "DELETE" }),
    onSuccess: () => (setDel(null), done("Pola dihapus")),
    onError: (e) => (setDel(null), toast(errMsg(e))),
  });
  const all = types.data ?? [];
  const s = useSession();
  const groups = new Map<string, SchedulePattern[]>();
  for (const p of list.data ?? []) groups.set(p.unit ?? "", [...(groups.get(p.unit ?? "") ?? []), p]);
  for (const u of s.isHead ? s.headUnits : []) if (!groups.has(u)) groups.set(u, []);
  const row = (p: SchedulePattern, i: number) => (
    <div key={p.id} className={cx("flex items-center gap-4 px-5 py-3", i > 0 && "border-t border-line2", !p.active && "opacity-60")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[13.5px] font-medium">
          {p.name}
          <span className="tnum ml-2 text-xs font-normal text-faint">
            {p.sequence.length} hari · {p.users} karyawan{!p.active && " · nonaktif"}
          </span>
        </span>
        <SequenceChips sequence={p.sequence} types={all} />
      </div>
      {p.editable && (
        <>
          <Toggle on={p.active} disabled={toggle.isPending} onChange={() => toggle.mutate(p)} label={`Pola ${p.name} aktif`} />
          <RowMenu
            actions={[
              { label: "Ubah", icon: <PencilLine size={15} />, onClick: () => setForm({ p }) },
              { label: "Hapus", icon: <Trash2 size={15} />, danger: true, onClick: () => setDel(p) },
            ]}
          />
        </>
      )}
    </div>
  );
  return (
    <>
      <SecCard
        title="Pola jadwal"
        flush
        action={
          <Button size="sm" onClick={() => setForm({ p: null })} disabled={!all.length}>
            <Plus size={15} /> Tambah pola
          </Button>
        }
      >
        {!list.data ? (
          <div className="p-5">
            <Skel className="h-24 rounded-lg" />
          </div>
        ) : groups.size === 0 ? (
          <Empty compact />
        ) : (
          [...groups].map(([unit, ps]) => (
            <div key={unit || "global"}>
              <div className="border-y border-line2 bg-track/50 px-5 py-2 text-xs font-medium text-muted first:border-t-0">{unit ? `Unit ${unit}` : "Pola Admin SDM"}</div>
              {ps.length ? ps.map(row) : <Empty compact />}
            </div>
          ))
        )}
      </SecCard>
      {form && <PatternForm p={form.p} types={all.filter((t) => t.active)} onClose={() => setForm(null)} onSaved={() => (setForm(null), done("Pola disimpan"))} />}
      {del && (
        <ConfirmModal
          title={`Hapus pola ${del.name}?`}
          body="Pola yang sudah pernah diterapkan ke karyawan tidak bisa dihapus; nonaktifkan saja."
          confirm="Hapus"
          danger
          loading={remove.isPending}
          onConfirm={() => remove.mutate(del)}
          onClose={() => setDel(null)}
        />
      )}
    </>
  );
}

function PatternForm({ p, types, onClose, onSaved }: { p: SchedulePattern | null; types: ShiftType[]; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const [name, setName] = useState(p?.name ?? "");
  const [seq, setSeq] = useState<(number | null)[]>(p?.sequence ?? [types[0]?.id ?? null]);
  // Kepala Unit beberapa unit: pola baru milik unit yang dipilih (default unit aktif di sidebar)
  const pickUnit = !p && s.isHead && s.headUnits.length > 1;
  const [unit, setUnit] = useState(s.ownUnit ?? s.headUnits[0] ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), sequence: seq, active: p?.active ?? true, ...(!p && s.isHead ? { unit: pickUnit ? unit : s.ownUnit } : {}) };
      return p ? api(`/api/v1/admin/patterns/${p.id}`, { method: "PUT", body }) : api("/api/v1/admin/patterns", { body });
    },
    onSuccess: onSaved,
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (name.trim().length < 2) return setErr("Isi nama pola.");
    if (seq.every((x) => x == null)) return setErr("Pola harus memuat minimal satu shift.");
    setErr(null);
    save.mutate();
  }
  return (
    <Modal open onClose={onClose} width={520} top={70}>
      <ModalHead title={p ? "Ubah pola jadwal" : "Tambah pola jadwal"} onClose={onClose} />
      <FormRow label="Nama pola" required>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rotasi 3 shift" className={inputCls} />
      </FormRow>
      {pickUnit && (
        <FormRow label="Unit" required>
          <Select big value={unit} onChange={setUnit} options={s.headUnits.map((u) => ({ value: u, label: u }))} />
        </FormRow>
      )}
      <FormRow label={`Urutan · ${seq.length} hari, lalu berulang`} required>
        <SequenceEditor value={seq} onChange={setSeq} types={types} />
      </FormRow>
      {p && p.users > 0 && <span className="text-[12.5px] text-muted">Perubahan berlaku untuk penerapan berikutnya.</span>}
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={save.isPending} onClick={submit}>
          Simpan
        </Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ hari libur nasional

const HOLIDAY_KINDS: { value: HolidayKind; label: string }[] = [
  { value: "nasional", label: "Libur nasional" },
  { value: "cuti_bersama", label: "Cuti bersama" },
  { value: "khusus", label: "Libur rumah sakit" },
];
const kindLabel = (k: HolidayKind) => HOLIDAY_KINDS.find((x) => x.value === k)?.label ?? k;

function HolidaySection() {
  const qc = useQueryClient();
  const toast = useToast();
  const year = new Date().getFullYear();
  const [y, setY] = useState(year);
  const list = useQuery({ queryKey: ["holidays", y], queryFn: () => api<Holiday[]>("/api/v1/admin/holidays", { query: { from: `${y}-01-01`, to: `${y}-12-31` } }) });
  const [form, setForm] = useState<{ h: Holiday | null } | null>(null);
  const [del, setDel] = useState<Holiday | null>(null);
  const remove = useMutation({
    mutationFn: (h: Holiday) => api(`/api/v1/admin/holidays/${h.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holidays"] });
      setDel(null);
      toast("Hari libur dihapus");
    },
    onError: (e) => (setDel(null), toast(errMsg(e))),
  });
  return (
    <>
      <SecCard
        title="Hari libur"
        flush
        action={
          <div className="flex items-center gap-2">
            <Select value={String(y)} onChange={(v) => setY(Number(v))} options={[year - 1, year, year + 1].map((v) => ({ value: String(v), label: String(v) }))} />
            <Button size="sm" onClick={() => setForm({ h: null })}>
              <Plus size={15} /> Tambah
            </Button>
          </div>
        }
      >
        {!list.data ? (
          <div className="p-5">
            <Skel className="h-20 rounded-lg" />
          </div>
        ) : list.data.length === 0 ? (
          <Empty compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-xs font-medium text-muted">
                  <th className="px-5 py-2.5 font-medium">Nama Hari Libur</th>
                  <th className="px-3 py-2.5 font-medium">Tanggal</th>
                  <th className="px-3 py-2.5 font-medium">Tipe</th>
                  <th className="w-[56px] px-3 py-2.5 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((h) => (
                  <tr key={h.id} className="border-b border-line2 last:border-0">
                    <td className="px-5 py-2.5 font-medium">{h.name}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-muted">{fmtDateLong(h.date)}</td>
                    <td className="px-3 py-2.5">
                      <span className={cx("rounded-md px-2 py-0.5 text-xs font-medium", h.kind === "nasional" ? "bg-bad-bg text-bad" : h.kind === "cuti_bersama" ? "bg-warn-bg text-warn" : "bg-soft text-muted")}>
                        {kindLabel(h.kind)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <RowMenu
                        actions={[
                          { label: "Ubah", icon: <PencilLine size={15} />, onClick: () => setForm({ h }) },
                          { label: "Hapus", icon: <Trash2 size={15} />, danger: true, onClick: () => setDel(h) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SecCard>
      {form && <HolidayForm h={form.h} year={y} onClose={() => setForm(null)} />}
      {del && (
        <ConfirmModal
          title={`Hapus ${del.name}?`}
          body={fmtDateLong(del.date)}
          confirm="Hapus"
          danger
          loading={remove.isPending}
          onConfirm={() => remove.mutate(del)}
          onClose={() => setDel(null)}
        />
      )}
    </>
  );
}

function HolidayForm({ h, year, onClose }: { h: Holiday | null; year: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: h?.name ?? "", date: h?.date ?? "", kind: h?.kind ?? ("nasional" as HolidayKind) });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), date: f.date, kind: f.kind };
      return h ? api(`/api/v1/admin/holidays/${h.id}`, { method: "PUT", body }) : api("/api/v1/admin/holidays", { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holidays"] });
      toast(h ? "Hari libur disimpan" : "Hari libur ditambahkan");
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  function submit() {
    if (f.name.trim().length < 2) return setErr("Nama hari libur minimal 2 huruf.");
    if (!f.date) return setErr("Pilih tanggal.");
    setErr(null);
    m.mutate();
  }
  return (
    <Modal open onClose={onClose} width={440}>
      <ModalHead title={h ? "Ubah hari libur" : "Tambah hari libur"} onClose={onClose} />
      <FormRow label="Nama hari libur" required>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Contoh: Hari Raya Idulfitri" className={inputCls} />
      </FormRow>
      <div className="grid grid-cols-2 gap-4">
        <FormRow label="Tanggal" required>
          <input type="date" value={f.date} min={h ? undefined : `${year - 1}-01-01`} onChange={(e) => setF({ ...f, date: e.target.value })} className={cx(inputCls, "tnum")} />
        </FormRow>
        <FormRow label="Tipe" required>
          <Select big value={f.kind} onChange={(v) => setF({ ...f, kind: v as HolidayKind })} options={HOLIDAY_KINDS} />
        </FormRow>
      </div>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} onClick={submit}>
          {h ? "Simpan" : "Tambah"}
        </Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ notifikasi (Kepala Unit)

const NOTIFS: [keyof KuNotifPrefs, string][] = [
  ["leave", "Pengajuan izin & sakit"],
  ["swap", "Tukar shift"],
  ["attendance", "Verifikasi presensi gagal"],
  ["schedule", "Pengingat terbit jadwal"],
];

function NotifSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const prefs = useQuery({ queryKey: ["notif-prefs"], queryFn: () => api<KuNotifPrefs>("/api/v1/admin/me/notif-prefs") });
  const [edits, setEdits] = useState<KuNotifPrefs | null>(null);
  const p = edits ?? prefs.data ?? null;
  const save = useMutation({
    mutationFn: () => api<KuNotifPrefs>("/api/v1/admin/me/notif-prefs", { method: "PUT", body: p }),
    onSuccess: (v) => {
      qc.setQueryData(["notif-prefs"], v);
      setEdits(null);
      toast("Notifikasi disimpan");
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <SecCard title="Notifikasi">
      {!p ? (
        <Skel className="h-40 rounded-lg" />
      ) : (
        <>
          {NOTIFS.map(([k, t], i) => (
            <Row key={k} title={t} first={i === 0}>
              <Toggle on={p[k]} onChange={(v) => setEdits({ ...p, [k]: v })} label={t} />
            </Row>
          ))}
          <div className="mt-2">
            <SaveBar dirty={!!edits && JSON.stringify(edits) !== JSON.stringify(prefs.data)} saving={save.isPending} onSave={() => save.mutate()} />
          </div>
        </>
      )}
    </SecCard>
  );
}

// ------------------------------------------------------------------ SMTP

function SmtpSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const s = useSession();
  const [testTo, setTestTo] = useState(s.me.user.email ?? "");
  const cfg = useQuery({ queryKey: ["smtp"], queryFn: () => api<SmtpConfig>("/api/v1/admin/smtp") });
  const [edits, setF] = useState<{ host: string; port: string; encryption: SmtpConfig["encryption"]; username: string; password: string; sender: string } | null>(null);
  const c = cfg.data;
  const f = edits ?? (c ? { host: c.host, port: String(c.port), encryption: c.encryption, username: c.username, password: "", sender: c.sender } : null);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<SmtpConfig>("/api/v1/admin/smtp", {
        method: "PUT",
        body: { host: f!.host.trim(), port: Number(f!.port), encryption: f!.encryption, username: f!.username.trim(), password: f!.password ? f!.password : null, sender: f!.sender.trim() },
      }),
    onSuccess: (v) => {
      qc.setQueryData(["smtp"], v);
      setF(null);
      toast("Konfigurasi SMTP disimpan");
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const test = useMutation({
    mutationFn: () => api<{ message: string }>("/api/v1/admin/smtp/test", { body: { to: testTo.trim() } }),
    onSuccess: (r) => toast(r.message),
    onError: (e) => setErr(errMsg(e)),
  });
  if (!f || !c) return <Skel className="h-80 rounded-xl" />;
  const dirty = !!edits && (f.host !== c.host || f.port !== String(c.port) || f.encryption !== c.encryption || f.username !== c.username || f.sender !== c.sender || f.password !== "");
  function submit() {
    const port = Number(f!.port);
    if (!f!.host.trim()) return setErr("Host wajib diisi.");
    if (!Number.isInteger(port) || port < 1 || port > 65535) return setErr("Port tidak valid.");
    if (!validEmail(f!.sender)) return setErr("Email pengirim tidak valid.");
    setErr(null);
    save.mutate();
  }
  const upd = (p: Partial<NonNullable<typeof f>>) => setF({ ...f!, ...p });
  return (
    <SecCard
      title="Konfigurasi SMTP"
      action={
        <div className="flex items-center gap-2">
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="Kirim uji ke email"
            aria-label="Email tujuan uji"
            className={cx(inputCls, "h-8 w-[220px] text-[13px]")}
          />
          <Button size="sm" disabled={!c.host || dirty || !validEmail(testTo)} loading={test.isPending} onClick={() => test.mutate()}>
            <Send size={14} /> Kirim uji SMTP
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px_160px]">
        <FormRow label="Host" required>
          <input value={f.host} onChange={(e) => upd({ host: e.target.value })} placeholder="smtp.gmail.com" className={inputCls} />
        </FormRow>
        <FormRow label="Port" required>
          <input value={f.port} inputMode="numeric" onChange={(e) => upd({ port: e.target.value.replace(/\D/g, "").slice(0, 5) })} className={cx(inputCls, "tnum")} />
        </FormRow>
        <FormRow label="Enkripsi" required>
          <Select
            big
            value={f.encryption}
            onChange={(v) => {
              const enc = v as SmtpConfig["encryption"];
              // port bawaan mengikuti enkripsi bila port belum diubah dari bawaan
              const port = ["587", "465", "25"].includes(f.port) ? (enc === "ssl" ? "465" : enc === "tls" ? "587" : "25") : f.port;
              upd({ encryption: enc, port });
            }}
            options={[
              { value: "tls", label: "TLS" },
              { value: "ssl", label: "SSL" },
              { value: "none", label: "Tanpa enkripsi" },
            ]}
          />
        </FormRow>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormRow label="Username">
          <input value={f.username} onChange={(e) => upd({ username: e.target.value })} autoComplete="off" className={inputCls} />
        </FormRow>
        <FormRow label="Password">
          <input
            type="password"
            value={f.password}
            onChange={(e) => upd({ password: e.target.value })}
            autoComplete="new-password"
            placeholder={c.has_password ? "•••••••• (tidak diubah)" : ""}
            className={inputCls}
          />
        </FormRow>
        <FormRow label="Email pengirim" required>
          <input value={f.sender} onChange={(e) => upd({ sender: e.target.value })} placeholder="noreply@awalbros.cc" className={inputCls} />
        </FormRow>
      </div>
      {err && <p className="mt-3 text-[13px] text-bad">{err}</p>}
      <div className="mt-4">
        <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} />
      </div>
    </SecCard>
  );
}
