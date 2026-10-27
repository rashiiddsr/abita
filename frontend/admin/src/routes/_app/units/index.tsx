import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PencilLine, Plus, Trash2 } from "lucide-react";
import { useRouter } from "@/lib/nav";
import { useState } from "react";
import { RowMenu } from "@/components/row-menu";
import { Page } from "@/components/shell";
import { DeleteUnitModal, UnitForm } from "@/components/unit-form";
import { Button, Card, Empty, ErrorState, PageHeader, Pager, SearchBox, Skel, SortHead, useSort, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { UnitOut } from "@/lib/types";

export const Route = createFileRoute("/_app/units/")({ component: KelolaUnitPage });

const PER_PAGE = 20;
// Admin SDM mengelola unit (menu ⋮). Klik baris membuka detail unit.
const COLS_MANAGE = "grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_96px_48px]";
const COLS_VIEW = "grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_96px]";

function KelolaUnitPage() {
  const s = useSession();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ unit: UnitOut | null } | null>(null);
  const [del, setDel] = useState<UnitOut | null>(null);
  const units = useQuery({ queryKey: ["units"], queryFn: () => api<UnitOut[]>("/api/v1/admin/units") });
  const manage = s.can.manage;
  const cols = manage ? COLS_MANAGE : COLS_VIEW;

  const k = q.trim().toLowerCase();
  const rows = (units.data ?? []).filter((u) => !k || u.name.toLowerCase().includes(k) || (u.head_name ?? "").toLowerCase().includes(k));
  const { sorted, sort, toggle: sortBy } = useSort(rows, { name: (u) => u.name, head: (u) => u.head_name, staff: (u) => u.staff_count });
  const maxPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const shown = sorted.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);

  return (
    <Page>
      <PageHeader
        title="Kelola Unit"
        action={
          manage && (
            <Button onClick={() => setForm({ unit: null })}>
              <Plus size={15} /> Tambah unit
            </Button>
          )
        }
      />
      {units.isError ? (
        <ErrorState message={(units.error as Error).message} onRetry={() => units.refetch()} />
      ) : (
        <Card>
          <div className="border-b border-line p-3">
            <SearchBox value={q} onChange={(v) => (setQ(v), setPage(0))} placeholder="Cari unit atau Kepala Unit" className="sm:w-full" />
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className={cx("grid gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", cols)}>
                <SortHead label="Unit" k="name" sort={sort} onSort={sortBy} />
                <SortHead label="Kepala Unit" k="head" sort={sort} onSort={sortBy} />
                <SortHead label="Karyawan" k="staff" sort={sort} onSort={sortBy} align="right" />
                {manage && <span />}
              </div>
              {units.isLoading &&
                [...Array(4)].map((_, i) => (
                  <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", cols)}>
                    <Skel className="h-4 w-1/2" />
                    <Skel className="h-4 w-2/3" />
                    <Skel className="ml-auto h-4 w-6" />
                    {manage && <span />}
                  </div>
                ))}
              {shown.map((u) => (
                <div
                  key={u.id}
                  onClick={() => router.push(`/units/${u.id}`)}
                  className={cx("grid cursor-pointer items-center gap-3 border-b border-line2 px-4 py-2.5 transition-colors last:border-0 hover:bg-hover", cols)}
                >
                  <span className="truncate text-[13.5px] font-medium">{u.name}</span>
                  <span className={cx("truncate text-[13px]", u.head_name ? "text-ink" : "text-muted")}>{u.head_name ?? "—"}</span>
                  <span className="tnum text-right text-[13px] text-muted">{u.staff_count}</span>
                  {manage && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <RowMenu
                        actions={[
                          { label: "Ubah", icon: <PencilLine size={15} />, onClick: () => setForm({ unit: u }) },
                          { label: "Hapus", icon: <Trash2 size={15} />, danger: true, onClick: () => setDel(u) },
                        ]}
                      />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {units.isSuccess && rows.length === 0 && <Empty />}
          <Pager page={cur} total={rows.length} perPage={PER_PAGE} onPage={setPage} />
        </Card>
      )}
      {form && <UnitForm unit={form.unit} onClose={() => setForm(null)} />}
      {del && <DeleteUnitModal unit={del} onClose={() => setDel(null)} />}
    </Page>
  );
}
