import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, PencilLine, Power, PowerOff, UserPlus } from "lucide-react";
import { useState } from "react";
import { AdminDetailDrawer } from "@/components/admin-detail";
import { AdminForm, useToggleAccount } from "@/components/admin-form";
import { BulkBar, BulkResultModal } from "@/components/bulk";
import { CredentialList, ResetPasswordFlow } from "@/components/credentials";
import { PillTabs } from "@/components/pill-tabs";
import { RowMenu } from "@/components/row-menu";
import { useToast } from "@/components/providers";
import { Page } from "@/components/shell";
import { ConfirmModal } from "@/components/staff-form";
import { Button, Card, Empty, ErrorState, Modal, ModalHead, PageHeader, Pager, Pill, SearchBox, Select, SelectBox, Skel, SortHead, Tag, Toggle, useSort, cx } from "@/components/ui";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { EMP_STATUS, ROLE_LABEL, ROLE_TONE } from "@/lib/status";
import type { BulkActionResult, BulkResetResult, User } from "@/lib/types";

export const Route = createFileRoute("/_app/admins")({
  component: KelolaAdminPage,
});

const PER_PAGE = 20;
// Admin SDM mengelola akun admin (centang massal + toggle + menu ⋮). Klik baris membuka panel detail akun.
const COLS_MANAGE = "grid-cols-[20px_minmax(0,2fr)_130px_minmax(0,1.4fr)_96px_48px]";
const COLS_VIEW = "grid-cols-[minmax(0,2fr)_130px_minmax(0,1.4fr)_110px]";

function KelolaAdminPage() {
  const s = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState<"all" | "admin" | "unit_head">("all");
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ user: User | null } | null>(null);
  const [pw, setPw] = useState<User | null>(null);
  const [view, setView] = useState<User | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [bulk, setBulk] = useState<"on" | "off" | "reset" | null>(null);
  const [statusResult, setStatusResult] = useState<BulkActionResult | null>(null);
  const [resetResult, setResetResult] = useState<BulkResetResult | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ["users", "manager"],
    queryFn: () => api<User[]>("/api/v1/admin/users", { query: { role: "manager" } }),
  });
  const toggle = useToggleAccount();
  const manage = s.can.manage;
  const cols = manage ? COLS_MANAGE : COLS_VIEW;
  const done = () => {
    setBulk(null);
    setSel([]);
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["units"] });
  };
  const bulkStatus = useMutation({
    mutationFn: (on: boolean) =>
      api<BulkActionResult>("/api/v1/admin/users/bulk-status", {
        body: { user_ids: sel, is_active: on },
      }),
    onSuccess: (r, on) => {
      done();
      if (r.failed.length) setStatusResult(r);
      else toast(`${r.done} akun ${on ? "diaktifkan" : "dinonaktifkan"}`);
    },
    onError: (e) => toast(errMsg(e)),
  });
  const bulkReset = useMutation({
    mutationFn: () =>
      api<BulkResetResult>("/api/v1/admin/users/bulk-reset-password", {
        body: { user_ids: sel },
      }),
    onSuccess: (r) => {
      done();
      if (r.failed.length) setResetResult(r);
      else toast(`Kata sandi ${r.sent} akun direset · dikirim ke email`);
    },
    onError: (e) => toast(errMsg(e)),
  });

  const k = q.trim().toLowerCase();
  const found = (list.data ?? []).filter(
    (u) =>
      (!k || u.name.toLowerCase().includes(k) || (u.email ?? "").toLowerCase().includes(k) || u.head_units.join(" ").toLowerCase().includes(k) || (u.unit ?? "").toLowerCase().includes(k)) &&
      (status === "all" || (status === "aktif" ? u.is_active !== false : u.is_active === false)),
  );
  const count = (r: typeof role) => (r === "all" ? found.length : found.filter((u) => u.role === r).length);
  const rows = found.filter((u) => role === "all" || u.role === role);
  const { sorted, sort, toggle: sortBy } = useSort(rows, {
    name: (u) => u.name,
    role: (u) => ROLE_LABEL[u.role],
    unit: (u) => (u.role === "unit_head" ? u.head_units.join(", ") : "Semua unit"),
    status: (u) => (u.is_active === false ? "nonaktif" : "aktif"),
  });
  const maxPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const shown = sorted.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);
  // akun sendiri tidak ikut aksi massal (nonaktif / reset diri sendiri)
  const pickable = rows.filter((u) => u.id !== s.me.user.id).map((u) => u.id);
  const allOn = pickable.length > 0 && pickable.every((id) => sel.includes(id));
  const pick = (id: number) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Page>
      <PageHeader
        left={
          <PillTabs
            label="Peran"
            value={role}
            onChange={(v) => (setRole(v), setPage(0))}
            tabs={[
              { value: "all", label: "Semua", count: count("all") },
              { value: "admin", label: "Admin SDM", count: count("admin") },
              {
                value: "unit_head",
                label: "Kepala Unit",
                count: count("unit_head"),
              },
            ]}
          />
        }
        action={
          manage && (
            <Button onClick={() => setForm({ user: null })}>
              <UserPlus size={15} /> Tambah admin
            </Button>
          )
        }
      />
      {list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => list.refetch()} />
      ) : (
        <Card>
          <div className="flex min-h-[57px] flex-wrap items-center gap-2 border-b border-line p-3">
            {sel.length > 0 ? (
              <BulkBar count={sel.length} noun="akun" onClear={() => setSel([])}>
                <Button size="sm" variant="outline" onClick={() => setBulk("on")}>
                  <Power size={14} /> Aktifkan
                </Button>
                <Button size="sm" variant="dangerOutline" onClick={() => setBulk("off")}>
                  <PowerOff size={14} /> Nonaktifkan
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBulk("reset")}>
                  <KeyRound size={14} /> Reset kata sandi
                </Button>
              </BulkBar>
            ) : (
              <>
                <SearchBox value={q} onChange={(v) => (setQ(v), setPage(0))} placeholder="Cari nama, email, atau unit" className="sm:w-auto sm:flex-1" />
                <Select
                  className="w-[150px] flex-none"
                  value={status}
                  onChange={(v) => (setStatus(v), setPage(0))}
                  options={[
                    { value: "all", label: "Semua status" },
                    { value: "aktif", label: "Aktif" },
                    { value: "nonaktif", label: "Nonaktif" },
                  ]}
                />
              </>
            )}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className={cx("grid items-center gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", cols)}>
                {manage && <SelectBox label="Pilih semua" on={allOn} some={sel.length > 0} disabled={!pickable.length} onClick={() => setSel(allOn ? [] : pickable)} />}
                <SortHead label="Nama" k="name" sort={sort} onSort={sortBy} />
                <SortHead label="Peran" k="role" sort={sort} onSort={sortBy} />
                <SortHead label="Unit" k="unit" sort={sort} onSort={sortBy} />
                <SortHead label="Status" k="status" sort={sort} onSort={sortBy} />
                {manage && <span />}
              </div>
              {list.isLoading &&
                [...Array(4)].map((_, i) => (
                  <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", cols)}>
                    {manage && <span />}
                    <Skel className="h-4 w-2/3" />
                    <Skel className="h-5 w-20 rounded-md" />
                    <Skel className="h-4 w-1/2" />
                    <Skel className="h-5 w-9 rounded-full" />
                    {manage && <span />}
                  </div>
                ))}
              {shown.map((u) => {
                const self = u.id === s.me.user.id;
                return (
                  <div
                    key={u.id}
                    onClick={() => setView(u)}
                    className={cx(
                      "grid cursor-pointer items-center gap-3 border-b border-line2 px-4 py-2.5 transition-colors last:border-0 hover:bg-hover",
                      sel.includes(u.id) && "bg-brand-soft/40",
                      cols,
                    )}
                  >
                    {manage && <SelectBox label={`Pilih ${u.name}`} on={sel.includes(u.id)} disabled={self} onClick={() => pick(u.id)} />}
                    <span className="truncate text-[13.5px] font-medium">
                      {u.name}
                      {self && <span className="ml-1.5 text-xs font-normal text-faint">(Anda)</span>}
                    </span>
                    <span>
                      <Tag tone={ROLE_TONE[u.role]} />
                    </span>
                    <span className="truncate text-[13px] text-muted">
                      {u.role === "unit_head" ? u.head_units.join(", ") || "—" : "Semua unit"}
                    </span>
                    {manage ? (
                      <>
                        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Toggle on={u.is_active !== false} disabled={self || toggle.isPending} onChange={() => toggle.mutate(u)} label={u.is_active === false ? "Aktifkan" : "Nonaktifkan"} />
                        </span>
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowMenu
                            actions={[
                              {
                                label: "Ubah data",
                                icon: <PencilLine size={15} />,
                                onClick: () => setForm({ user: u }),
                              },
                              {
                                label: "Reset kata sandi",
                                icon: <KeyRound size={15} />,
                                onClick: () => setPw(u),
                                hidden: self,
                              },
                            ]}
                          />
                        </span>
                      </>
                    ) : (
                      <span>
                        <Pill tone={EMP_STATUS[u.is_active === false ? "nonaktif" : "aktif"]} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {list.isSuccess && rows.length === 0 && <Empty />}
          <Pager page={cur} total={rows.length} perPage={PER_PAGE} onPage={setPage} />
        </Card>
      )}
      {form && <AdminForm user={form.user} onClose={() => setForm(null)} />}
      {pw && <ResetPasswordFlow user={pw} onClose={() => setPw(null)} />}
      <AdminDetailDrawer user={view} onClose={() => setView(null)} />
      {(bulk === "on" || bulk === "off") && (
        <ConfirmModal
          title={`${bulk === "on" ? "Aktifkan" : "Nonaktifkan"} ${sel.length} akun?`}
          body={bulk === "on" ? "Akun bisa masuk lagi ke dasbor admin." : "Akun tidak bisa masuk ke dasbor admin sampai diaktifkan kembali."}
          confirm={bulk === "on" ? "Aktifkan" : "Nonaktifkan"}
          danger={bulk === "off"}
          loading={bulkStatus.isPending}
          onConfirm={() => bulkStatus.mutate(bulk === "on")}
          onClose={() => setBulk(null)}
        />
      )}
      {bulk === "reset" && (
        <ConfirmModal
          title={`Reset kata sandi ${sel.length} akun?`}
          body="Kata sandi baru dikirim ke email masing-masing dan wajib diganti saat masuk."
          confirm="Reset kata sandi"
          loading={bulkReset.isPending}
          onConfirm={() => bulkReset.mutate()}
          onClose={() => setBulk(null)}
        />
      )}
      {statusResult && <BulkResultModal title="Status akun diperbarui" result={statusResult} onClose={() => setStatusResult(null)} />}
      {resetResult && (
        <Modal open onClose={() => setResetResult(null)} width={480}>
          <ModalHead title="Kata sandi direset" sub={`${resetResult.sent} terkirim lewat email`} onClose={() => setResetResult(null)} />
          <CredentialList rows={resetResult.failed} />
          <div className="flex justify-end">
            <Button onClick={() => setResetResult(null)}>Selesai</Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
