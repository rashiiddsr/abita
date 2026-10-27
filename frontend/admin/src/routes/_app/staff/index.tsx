import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, PencilLine, ScanFace, Upload, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "@/lib/nav";
import { Suspense, useState } from "react";
import { CredentialList } from "@/components/credentials";
import { ImportModal, ImportSummary } from "@/components/import-modal";
import { useToast } from "@/components/providers";
import { RowMenu } from "@/components/row-menu";
import { Page } from "@/components/shell";
import { useStaffActions } from "@/components/staff-actions";
import { ConfirmModal, StaffFormModal } from "@/components/staff-form";
import { PillTabs } from "@/components/pill-tabs";
import { Button, Card, Empty, ErrorState, Modal, ModalHead, PageHeader, Pager, Pill, SearchBox, SelectBox, Skel, SortHead, Tag, Toggle, useSort, cx } from "@/components/ui";
import { api, download, errMsg } from "@/lib/api";
import { useScopeUnit, useSession } from "@/lib/session";
import { EMP_STATUS, tipe } from "@/lib/status";
import type { StaffRow, User } from "@/lib/types";

export const Route = createFileRoute("/_app/staff/")({ component: KaryawanPage });

const PER_PAGE = 20;
// Admin SDM (semua unit) & Kepala Unit (unitnya): toggle status + menu ⋮; klik baris membuka detail
const COLS_MANAGE = "grid-cols-[20px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_96px_48px]";

type Cred = { name: string; email: string; temp_password: string | null; error: string | null };
type ImportResult = { created: number; updated: number; errors: string[]; credentials: Cred[] };

const COLS_VIEW = "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_110px]";

function KaryawanPage() {
  return (
    <Suspense
      fallback={
        <Page>
          <Skel className="h-96 rounded-xl" />
        </Page>
      }
    >
      <KaryawanFromUrl />
    </Suspense>
  );
}

// Pencarian dari header (?q=) membuat ulang daftar dengan filter baru.
function KaryawanFromUrl() {
  const sp = useSearchParams();
  return <Karyawan key={sp.toString()} initQ={sp.get("q") ?? ""} />;
}

function Karyawan({ initQ }: { initQ: string }) {
  const router = useRouter();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const unit = useScopeUnit();
  const [q, setQ] = useState(initQ);
  const [tab, setTab] = useState<"all" | "outsourcing" | "magang">("all");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const [modal, setModal] = useState<"import" | "reset" | null>(null);
  const [resetResult, setResetResult] = useState<{ sent: number; failed: Cred[] } | null>(null);
  const actions = useStaffActions();
  const manage = s.can.manageStaff;
  const cols = manage ? COLS_MANAGE : COLS_VIEW;

  const list = useQuery({ queryKey: ["staff", unit], queryFn: () => api<StaffRow[]>("/api/v1/admin/staff", { query: { unit } }) });
  const toggle = useMutation({
    mutationFn: (u: User) => api<User>(`/api/v1/admin/users/${u.id}`, { method: "PUT", body: { is_active: u.is_active === false } }),
    onMutate: async (u) => {
      // optimis: toggle langsung berubah
      qc.setQueryData<StaffRow[]>(["staff", unit], (rows) =>
        rows?.map((r) => (r.user.id === u.id ? { ...r, user: { ...r.user, is_active: u.is_active === false }, status: u.is_active === false ? "aktif" : "nonaktif" } : r)),
      );
    },
    onSuccess: (u) => toast(`${u.name} ${u.is_active === false ? "dinonaktifkan" : "diaktifkan"}`),
    onError: (e) => toast(errMsg(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const bulkReset = useMutation({
    mutationFn: () => api<{ sent: number; failed: Cred[] }>("/api/v1/admin/users/bulk-reset-password", { body: { user_ids: sel } }),
    onSuccess: (r) => {
      setModal(null);
      setSel([]);
      if (r.failed.length) setResetResult(r);
      else toast(`Kata sandi ${r.sent} karyawan direset · dikirim ke email`);
    },
    onError: (e) => toast(errMsg(e)),
  });
  const exportFile = () => download(`/api/v1/admin/staff/export${unit ? `?unit=${encodeURIComponent(unit)}` : ""}`, `Karyawan_${unit ?? "semua_unit"}.xlsx`).catch((e) => toast(errMsg(e)));

  const all = list.data ?? [];
  const k = q.trim().toLowerCase();
  const found = all.filter((r) => !k || r.user.name.toLowerCase().includes(k) || r.user.employee_code.toLowerCase().includes(k) || (r.user.unit ?? "").toLowerCase().includes(k));
  const count = (t: typeof tab) => (t === "all" ? found.length : found.filter((r) => r.user.employment_type === t).length);
  const rows = found.filter((r) => tab === "all" || r.user.employment_type === tab);
  const { sorted, sort, toggle: sortBy } = useSort(rows, {
    name: (r) => r.user.name,
    tipe: (r) => tipe(r.user.employment_type).label.replace("—", ""),
    unit: (r) => r.user.unit,
    status: (r) => r.status,
  });
  const maxPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const shown = sorted.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);

  return (
    <Page>
      <PageHeader
        left={
          <PillTabs
            label="Tipe karyawan"
            value={tab}
            onChange={(v) => (setTab(v), setPage(0))}
            tabs={[
              { value: "all", label: "Semua", count: count("all") },
              { value: "outsourcing", label: "Outsourcing", count: count("outsourcing") },
              { value: "magang", label: "Magang/PKL", count: count("magang") },
            ]}
          />
        }
        action={
          <>
            <Button variant="outline" onClick={exportFile}>
              <Download size={15} /> Ekspor
            </Button>
            {manage && (
              <>
                <Button variant="outline" onClick={() => setModal("import")}>
                  <Upload size={15} /> Impor
                </Button>
                <Button onClick={() => setAdding(true)}>
                  <UserPlus size={15} /> Tambah karyawan
                </Button>
              </>
            )}
          </>
        }
      />
      {list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => list.refetch()} />
      ) : (
        <Card>
          <div className="flex min-h-[57px] items-center gap-2 border-b border-line p-3">
            {sel.length > 0 ? (
              <>
                <span className="tnum text-[13px] font-medium">{sel.length} karyawan dipilih</span>
                <Button size="sm" variant="outline" onClick={() => setModal("reset")}>
                  <KeyRound size={14} /> Reset kata sandi
                </Button>
                <button onClick={() => setSel([])} className="h-8 px-2 text-[13px] text-muted hover:text-ink">
                  Batal
                </button>
              </>
            ) : (
              <SearchBox value={q} onChange={(v) => (setQ(v), setPage(0))} placeholder="Cari nama, NIK, atau unit" className="sm:w-auto sm:flex-1" />
            )}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className={cx("grid items-center gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", cols)}>
                {manage && (
                  <SelectBox
                    label="Pilih semua"
                    on={rows.length > 0 && rows.every((r) => sel.includes(r.user.id))}
                    some={sel.length > 0}
                    onClick={() => setSel(rows.every((r) => sel.includes(r.user.id)) ? [] : rows.map((r) => r.user.id))}
                  />
                )}
                <SortHead label="Nama" k="name" sort={sort} onSort={sortBy} />
                <SortHead label="Tipe" k="tipe" sort={sort} onSort={sortBy} />
                <SortHead label="Unit" k="unit" sort={sort} onSort={sortBy} />
                <SortHead label="Status" k="status" sort={sort} onSort={sortBy} />
                {manage && <span />}
              </div>
              {list.isLoading &&
                [...Array(6)].map((_, i) => (
                  <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", cols)}>
                    {manage && <span />}
                    <Skel className="h-4 w-2/3" />
                    <Skel className="h-4 w-20" />
                    <Skel className="h-4 w-1/2" />
                    <Skel className="h-5 w-9 rounded-full" />
                    {manage && <span />}
                  </div>
                ))}
              {shown.map((r) => {
                const u = r.user;
                return (
                  <div
                    key={u.id}
                    onClick={() => router.push(`/staff/${u.id}`)}
                    className={cx("grid cursor-pointer items-center gap-3 border-b border-line2 px-4 py-2.5 transition-colors last:border-0 hover:bg-hover", sel.includes(u.id) && "bg-brand-soft/40", cols)}
                  >
                    {manage && <SelectBox label={`Pilih ${u.name}`} on={sel.includes(u.id)} onClick={() => setSel((cur) => (cur.includes(u.id) ? cur.filter((x) => x !== u.id) : [...cur, u.id]))} />}
                    <span className="flex min-w-0 flex-col">
                      <span className={cx("truncate text-[13.5px] font-medium", r.status !== "aktif" && "text-muted")}>{u.name}</span>
                      <span className="tnum text-xs text-muted">{u.employee_code}</span>
                    </span>
                    <span>
                      <Tag tone={tipe(u.employment_type)} />
                    </span>
                    <span className="truncate text-[13px] text-muted">{u.unit ?? "—"}</span>
                    {manage ? (
                      <>
                        <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
                          <Toggle on={u.is_active !== false} onChange={() => toggle.mutate(u)} label={u.is_active === false ? "Aktifkan" : "Nonaktifkan"} />
                        </span>
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowMenu
                            actions={[
                              { label: "Ubah data", icon: <PencilLine size={15} />, onClick: () => actions.open(u, "edit") },
                              { label: "Reset kata sandi", icon: <KeyRound size={15} />, onClick: () => actions.open(u, "password") },
                              { label: "Reset wajah", icon: <ScanFace size={15} />, onClick: () => actions.open(u, "face"), hidden: !u.face_enrolled_at },
                            ]}
                          />
                        </span>
                      </>
                    ) : (
                      <span>
                        <Pill tone={EMP_STATUS[r.status]} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {list.isSuccess && rows.length === 0 && (
            <Empty
              action={
                !all.length &&
                manage && (
                  <Button onClick={() => setAdding(true)}>
                    <UserPlus size={15} /> Tambah karyawan
                  </Button>
                )
              }
            />
          )}
          <Pager page={cur} total={rows.length} perPage={PER_PAGE} onPage={setPage} />
        </Card>
      )}
      {adding && <StaffFormModal onClose={() => setAdding(false)} />}
      {modal === "import" && (
        <ImportModal<ImportResult>
          title="Impor karyawan"
          sub={s.ownUnit ?? undefined}
          template={{ label: "Template impor karyawan", download: () => download("/api/v1/admin/staff/template", "Template_impor_karyawan.xlsx") }}
          upload={async (file) => {
            const fd = new FormData();
            fd.append("file", file);
            const r = await api<ImportResult>("/api/v1/admin/staff/import", { body: fd });
            if (r.created || r.updated) qc.invalidateQueries({ queryKey: ["staff"] });
            return r;
          }}
          renderResult={(r) => (
            <ImportSummary
              stats={[
                { label: "Ditambahkan", value: r.created, tone: "ok" },
                { label: "Diperbarui", value: r.updated, tone: "ok" },
                { label: "Bermasalah", value: r.errors.length, tone: "warn" },
              ]}
              errors={r.errors}
            >
              <CredentialList rows={r.credentials} />
            </ImportSummary>
          )}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "reset" && (
        <ConfirmModal
          title={`Reset kata sandi ${sel.length} karyawan?`}
          body="Kata sandi baru dikirim ke email masing-masing dan wajib diganti saat masuk."
          confirm="Reset kata sandi"
          loading={bulkReset.isPending}
          onConfirm={() => bulkReset.mutate()}
          onClose={() => setModal(null)}
        />
      )}
      {resetResult && (
        <Modal open onClose={() => setResetResult(null)} width={480}>
          <ModalHead title="Kata sandi direset" sub={`${resetResult.sent} terkirim lewat email`} onClose={() => setResetResult(null)} />
          <CredentialList rows={resetResult.failed} />
          <div className="flex justify-end">
            <Button onClick={() => setResetResult(null)}>Selesai</Button>
          </div>
        </Modal>
      )}
      {actions.modal}
    </Page>
  );
}
