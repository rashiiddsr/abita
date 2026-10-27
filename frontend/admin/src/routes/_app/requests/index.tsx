import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Eye, FileText, Repeat2, Stethoscope, X } from "lucide-react";
import { useRouter } from "@/lib/nav";
import { useState } from "react";
import { BulkBar, BulkResultModal } from "@/components/bulk";
import { DateFilter, type DateRange } from "@/components/date-range";
import { PillTabs } from "@/components/pill-tabs";
import { useToast } from "@/components/providers";
import { BulkReviewModal, LeaveModals, SwapApproveModal, SwapRejectModal, leaveDuration, type ReviewKind } from "@/components/review";
import { RowMenu } from "@/components/row-menu";
import { Page } from "@/components/shell";
import { Button, Card, Empty, ErrorState, LockedScope, PageHeader, Pager, Pill, SearchBox, Select, SelectBox, Skel, SortHead, useSort, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtRange, todayWib, wibParts } from "@/lib/format";
import { useMounted, useSession } from "@/lib/session";
import { KIND, REQ, swapTone, toneStyle, type Tone } from "@/lib/status";
import type { BulkActionResult, LeaveOut, ReqStatus, SwapOut } from "@/lib/types";

export const Route = createFileRoute("/_app/requests/")({
  component: PengajuanPage,
});

const PER_PAGE = 20;
type Tab = "pending" | "approved" | "rejected" | "all";
type Kind = "izin" | "sakit" | "tukar";
// kolom centang + Aksi (⋮ setujui/tolak) hanya untuk Kepala Unit; Admin SDM membuka detail lewat klik baris
const COLS_REVIEW = "grid-cols-[20px_minmax(0,1.8fr)_minmax(0,1.4fr)_120px_minmax(0,1.3fr)_120px_48px]";
const COLS_VIEW = "grid-cols-[minmax(0,1.8fr)_minmax(0,1.4fr)_120px_minmax(0,1.3fr)_120px]";
const SWAP_TONE = { label: "Tukar shift", bg: "#FFF3D9", fg: "#8A5600" };

/** Satu baris daftar: Izin/Sakit (leave) atau Tukar shift (swap). */
type Row = {
  key: string;
  kind: Kind;
  name: string;
  code: string;
  unit: string | null;
  date: string;
  dateSub: string;
  status: ReqStatus;
  pill: Tone;
  created: string;
  canReview: boolean;
  href: string;
  leave?: LeaveOut;
  swap?: SwapOut;
};

function PengajuanPage() {
  const router = useRouter();
  const s = useSession();
  const today = useMounted(() => todayWib());
  const [tab, setTab] = useState<Tab>("pending");
  const [picked, setRange] = useState<DateRange | null>(null);
  // default "Semua": sejak pengajuan pertama s.d. hari ini
  const range: DateRange | null = picked ?? (today ? { from: null, to: today } : null);
  const [q, setQ] = useState("");
  const [jenis, setJenis] = useState("all");
  const [unit, setUnit] = useState("all");
  const [page, setPage] = useState(0);
  const [leaveModal, setLeaveModal] = useState<{
    req: LeaveOut;
    kind: ReviewKind;
  } | null>(null);
  const [swapModal, setSwapModal] = useState<{
    swap: SwapOut;
    approve: boolean;
  } | null>(null);

  // pilih banyak: hanya pengajuan menunggu yang boleh diputuskan akun ini (kunci baris "l12" / "s7")
  const [sel, setSel] = useState<string[]>([]);
  const [bulk, setBulk] = useState<boolean | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const toast = useToast();

  const leaves = useQuery({
    queryKey: ["leaves", "all"],
    queryFn: () => api<LeaveOut[]>("/api/v1/admin/leaves"),
    refetchInterval: 60_000,
  });
  const swaps = useQuery({
    queryKey: ["swaps", "all"],
    queryFn: () => api<SwapOut[]>("/api/v1/admin/swaps"),
    refetchInterval: 60_000,
  });

  const all: Row[] = [
    ...(leaves.data ?? []).map((l) => ({
      key: `l${l.id}`,
      kind: l.kind,
      name: l.name ?? "",
      code: l.employee_code ?? "",
      unit: l.unit,
      date: fmtRange(l.start_date, l.end_date),
      dateSub: leaveDuration(l),
      status: l.status,
      pill: REQ[l.status],
      created: l.created_at,
      canReview: l.can_review,
      href: `/requests/${l.id}`,
      leave: l,
    })),
    ...(swaps.data ?? []).map((w) => ({
      key: `s${w.id}`,
      kind: "tukar" as const,
      name: w.name ?? "",
      code: w.employee_code ?? "",
      unit: w.unit,
      date: fmtRange(w.date, w.target_date ?? w.date),
      dateSub: w.target_name ? `↔ ${w.target_name} · ${w.from_shift?.name ?? "—"} ↔ ${w.to_shift.name}` : `${w.from_shift?.name ?? "Libur"} → ${w.to_shift.name}`,
      status: w.status,
      pill: swapTone(w),
      created: w.created_at,
      canReview: w.can_review,
      href: `/requests/swap/${w.id}`,
      swap: w,
    })),
  ];

  const cols = s.can.review ? COLS_REVIEW : COLS_VIEW;
  const effUnit = s.lockedUnit ?? (unit === "all" ? null : unit);
  const k = q.trim().toLowerCase();
  const scoped = all.filter(
    (r) =>
      (!effUnit || r.unit === effUnit) &&
      (jenis === "all" || r.kind === jenis) &&
      (!k || r.name.toLowerCase().includes(k) || r.code.toLowerCase().includes(k)) &&
      (!range || ((!range.from || wibParts(r.created).date >= range.from) && wibParts(r.created).date <= range.to)),
  );
  const count = (t: Tab) => (t === "all" ? scoped.length : scoped.filter((r) => r.status === t).length);
  const rows = scoped.filter((r) => tab === "all" || r.status === tab).sort((a, b) => (tab === "pending" ? a.created.localeCompare(b.created) : b.created.localeCompare(a.created)));
  const { sorted, sort, toggle: sortBy } = useSort(rows, {
    name: (r) => r.name,
    unit: (r) => r.unit,
    kind: (r) => (r.kind === "tukar" ? "Tukar shift" : KIND[r.kind].label),
    date: (r) => r.leave?.start_date ?? r.swap?.date ?? null,
    status: (r) => r.pill.label,
  });
  const maxPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const shown = sorted.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);
  const loading = leaves.isLoading || swaps.isLoading;
  const pickable = rows.filter((r) => r.canReview && r.status === "pending").map((r) => r.key);
  // pilihan yang sudah tidak bisa diputuskan (diproses orang lain / tersaring) otomatis gugur
  const chosen = sel.filter((x) => pickable.includes(x));
  const allOn = pickable.length > 0 && pickable.every((x) => chosen.includes(x));
  const pick = (key: string) => setSel((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur.filter((x) => pickable.includes(x)), key]));
  const items = chosen.map((key) => ({
    kind: key[0] === "l" ? ("leave" as const) : ("swap" as const),
    id: Number(key.slice(1)),
  }));
  const error = leaves.error ?? swaps.error;

  return (
    <Page>
      {/* kiri: status · kanan: preset & rentang tanggal */}
      <PageHeader
        left={
          <PillTabs
            label="Status pengajuan"
            value={tab}
            onChange={(v) => (setTab(v), setPage(0))}
            tabs={[
              { value: "pending", label: "Menunggu", count: count("pending") },
              {
                value: "approved",
                label: "Disetujui",
                count: count("approved"),
              },
              { value: "rejected", label: "Ditolak", count: count("rejected") },
              { value: "all", label: "Semua", count: count("all") },
            ]}
          />
        }
        action={today && range && <DateFilter value={range} today={today} onChange={(r) => (setRange(r), setPage(0))} />}
      />

      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => (leaves.refetch(), swaps.refetch())} />
      ) : (
        <Card>
          <div className="flex min-h-[57px] flex-wrap items-center gap-2 border-b border-line p-3">
            {chosen.length > 0 ? (
              <BulkBar count={chosen.length} noun="pengajuan" onClear={() => setSel([])}>
                <Button size="sm" variant="outline" onClick={() => setBulk(true)}>
                  <Check size={14} /> Setujui
                </Button>
                <Button size="sm" variant="dangerOutline" onClick={() => setBulk(false)}>
                  <X size={14} /> Tolak
                </Button>
              </BulkBar>
            ) : (
              <>
                <SearchBox value={q} onChange={(v) => (setQ(v), setPage(0))} className="sm:w-auto sm:flex-1" />
                <Select
                  className="w-[160px] flex-none"
                  value={jenis}
                  onChange={(v) => (setJenis(v), setPage(0))}
                  options={[
                    { value: "all", label: "Semua jenis" },
                    { value: "izin", label: "Izin" },
                    { value: "sakit", label: "Sakit" },
                    { value: "tukar", label: "Tukar shift" },
                  ]}
                />
                {!s.lockedUnit ? (
                  <Select
                    className="w-[200px] flex-none"
                    value={unit}
                    onChange={(v) => (setUnit(v), setPage(0))}
                    options={[{ value: "all", label: "Semua unit" }, ...s.units.map((u) => ({ value: u.name, label: u.name }))]}
                  />
                ) : (
                  s.can.unitFilter && <LockedScope label={s.lockedUnit} />
                )}
              </>
            )}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className={cx("grid items-center gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", cols)}>
                {s.can.review && <SelectBox label="Pilih semua yang bisa diputuskan" on={allOn} some={chosen.length > 0} disabled={!pickable.length} onClick={() => setSel(allOn ? [] : pickable)} />}
                <SortHead label="Karyawan" k="name" sort={sort} onSort={sortBy} />
                <SortHead label="Unit" k="unit" sort={sort} onSort={sortBy} />
                <SortHead label="Jenis" k="kind" sort={sort} onSort={sortBy} />
                <SortHead label="Tanggal" k="date" sort={sort} onSort={sortBy} />
                <SortHead label="Status" k="status" sort={sort} onSort={sortBy} />
                {s.can.review && <span />}
              </div>
              {loading &&
                [...Array(5)].map((_, i) => (
                  <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", cols)}>
                    {s.can.review && <span />}
                    <Skel className="h-4 w-2/3" />
                    <Skel className="h-4 w-1/2" />
                    <Skel className="h-4 w-16" />
                    <Skel className="h-4 w-24" />
                    <Skel className="h-5 w-20 rounded-md" />
                    {s.can.review && <span />}
                  </div>
                ))}
              {!loading &&
                shown.map((r) => {
                  const tone = r.kind === "tukar" ? SWAP_TONE : KIND[r.kind];
                  const Icon = r.kind === "tukar" ? Repeat2 : r.kind === "sakit" ? Stethoscope : FileText;
                  return (
                    <div
                      key={r.key}
                      onClick={() => router.push(r.href)}
                      className={cx(
                        "grid cursor-pointer items-center gap-3 border-b border-line2 px-4 py-2.5 transition-colors last:border-0 hover:bg-hover",
                        chosen.includes(r.key) && "bg-brand-soft/40",
                        cols,
                      )}
                    >
                      {s.can.review && (pickable.includes(r.key) ? <SelectBox label={`Pilih pengajuan ${r.name}`} on={chosen.includes(r.key)} onClick={() => pick(r.key)} /> : <span />)}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13.5px] font-medium">{r.name}</span>
                        <span className="tnum text-xs text-muted">{r.code}</span>
                      </span>
                      <span className="truncate text-[13px] text-muted">{r.unit ?? "—"}</span>
                      <span className="flex items-center gap-2 text-[13px]">
                        <span className="flex size-6 flex-none items-center justify-center rounded-md" style={toneStyle(tone.bg, tone.fg)}>
                          <Icon size={13} />
                        </span>
                        <span className="truncate">{tone.label}</span>
                      </span>
                      <span className="tnum flex min-w-0 flex-col">
                        <span className="whitespace-nowrap text-[13px]">{r.date}</span>
                        <span className="truncate text-xs text-muted">{r.dateSub}</span>
                      </span>
                      <span>
                        <Pill tone={r.pill} />
                      </span>
                      {s.can.review && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowMenu
                            actions={[
                              {
                                label: "Lihat detail",
                                icon: <Eye size={15} />,
                                onClick: () => router.push(r.href),
                              },
                              {
                                label: "Setujui",
                                icon: <Check size={15} />,
                                hidden: !r.canReview,
                                onClick: () =>
                                  r.leave
                                    ? setLeaveModal({
                                        req: r.leave,
                                        kind: "approve",
                                      })
                                    : setSwapModal({
                                        swap: r.swap!,
                                        approve: true,
                                      }),
                              },
                              {
                                label: "Tolak",
                                icon: <X size={15} />,
                                danger: true,
                                hidden: !r.canReview,
                                onClick: () =>
                                  r.leave
                                    ? setLeaveModal({
                                        req: r.leave,
                                        kind: "reject",
                                      })
                                    : setSwapModal({
                                        swap: r.swap!,
                                        approve: false,
                                      }),
                              },
                            ]}
                          />
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          {!loading && rows.length === 0 && <Empty />}
          <Pager page={cur} total={rows.length} perPage={PER_PAGE} onPage={setPage} />
        </Card>
      )}
      <LeaveModals req={leaveModal?.req ?? null} kind={leaveModal?.kind ?? null} onClose={() => setLeaveModal(null)} />
      <SwapApproveModal swap={swapModal?.approve ? swapModal.swap : null} onClose={() => setSwapModal(null)} />
      <SwapRejectModal swap={swapModal && !swapModal.approve ? swapModal.swap : null} onClose={() => setSwapModal(null)} />
      {bulk !== null && (
        <BulkReviewModal
          items={items}
          approve={bulk}
          onClose={() => setBulk(null)}
          onDone={(r) => {
            const approve = bulk;
            setBulk(null);
            setSel([]);
            if (r.failed.length) setBulkResult(r);
            else toast(`${r.done} pengajuan ${approve ? "disetujui" : "ditolak"} · notifikasi terkirim`);
          }}
        />
      )}
      {bulkResult && <BulkResultModal title="Pengajuan diproses" result={bulkResult} onClose={() => setBulkResult(null)} />}
    </Page>
  );
}
