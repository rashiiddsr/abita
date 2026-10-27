import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, PencilLine, Trash2 } from "lucide-react";
import { useParams, useRouter } from "@/lib/nav";
import { useState } from "react";
import { AdminDetailDrawer } from "@/components/admin-detail";
import { Page, useCrumb } from "@/components/shell";
import { DeleteUnitModal, UnitForm } from "@/components/unit-form";
import { Button, Card, Empty, ErrorState, Field, Pager, Pill, Skel, SortHead, Tag, useSort, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { phoneDisplay } from "@/lib/format";
import { useSession } from "@/lib/session";
import { EMP_STATUS, tipe } from "@/lib/status";
import type { StaffRow, UnitOut, User } from "@/lib/types";

export const Route = createFileRoute("/_app/units/$id")({ component: UnitDetail });

const PER_PAGE = 20;
const cols = "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px]";

function UnitDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const s = useSession();
  const [modal, setModal] = useState<"edit" | "delete" | null>(null);
  const [page, setPage] = useState(0);
  const [viewHead, setViewHead] = useState<number | null>(null);
  const units = useQuery({ queryKey: ["units"], queryFn: () => api<UnitOut[]>("/api/v1/admin/units") });
  const managers = useQuery({ queryKey: ["users", "manager"], queryFn: () => api<User[]>("/api/v1/admin/users", { query: { role: "manager" } }) });
  const unit = units.data?.find((u) => u.id === Number(id));
  const staff = useQuery({
    queryKey: ["staff", unit?.name],
    queryFn: () => api<StaffRow[]>("/api/v1/admin/staff", { query: { unit: unit!.name } }),
    enabled: !!unit,
  });
  useCrumb(unit?.name);
  const back = null;

  // diurutkan sebelum return awal (aturan hook)
  const { sorted, sort, toggle: sortBy } = useSort(staff.data ?? [], {
    name: (r) => r.user.name,
    tipe: (r) => tipe(r.user.employment_type).label.replace("—", ""),
    status: (r) => r.status,
  });

  if (units.isError) return <Page>{back}<ErrorState message={(units.error as Error).message} onRetry={() => units.refetch()} /></Page>;
  if (!units.data)
    return (
      <Page>
        {back}
        <Skel className="h-36 rounded-xl" />
        <Skel className="h-72 rounded-xl" />
      </Page>
    );
  if (!unit) return <Page>{back}<Empty title="Unit tidak ditemukan" /></Page>;

  const account = (id: number) => managers.data?.find((m) => m.id === id) ?? null;
  const rows = staff.data ?? [];
  const maxPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const shown = sorted.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);
  const active = rows.filter((r) => r.status === "aktif").length;

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {back}
        {s.can.manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setModal("edit")}>
              <PencilLine size={16} /> Ubah
            </Button>
            <Button variant="dangerOutline" onClick={() => setModal("delete")}>
              <Trash2 size={16} /> Hapus
            </Button>
          </div>
        )}
      </div>

      <Card className="px-[22px] py-5">
        <div className="flex items-center gap-4">
          <span className="flex size-14 flex-none items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Building2 size={24} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xl font-semibold">{unit.name}</span>
            <span className="tnum text-[13px] text-muted">{unit.staff_count} karyawan aktif</span>
          </div>
        </div>
        <div className="mt-5 grid gap-3.5 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-1 lg:col-span-3">
            <Field label={unit.heads.length > 1 ? `Kepala Unit (${unit.heads.length})` : "Kepala Unit"}>
              {unit.heads.length ? (
                <span className="flex flex-col gap-1.5">
                  {unit.heads.map((h) => {
                    const a = account(h.id);
                    return (
                      <span key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                        <button onClick={() => setViewHead(h.id)} className="text-left text-brand hover:underline">
                          {h.name}
                        </button>
                        {a && <span className="tnum text-xs text-muted">{[a.email, a.phone ? phoneDisplay(a.phone) : null].filter(Boolean).join(" · ")}</span>}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Field>
          </div>
          <Field label="Karyawan">
            <span className="tnum">
              {active} aktif{rows.length > active ? ` · ${rows.length - active} nonaktif` : ""}
            </span>
          </Field>
        </div>
      </Card>

      <Card>
        <div className="border-b border-line px-4 py-3 text-[15px] font-semibold">Karyawan</div>
        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            <div className={cx("grid gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", cols)}>
              <SortHead label="Nama" k="name" sort={sort} onSort={sortBy} />
              <SortHead label="Tipe" k="tipe" sort={sort} onSort={sortBy} />
              <SortHead label="Status" k="status" sort={sort} onSort={sortBy} />
            </div>
            {staff.isLoading &&
              [...Array(4)].map((_, i) => (
                <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", cols)}>
                  <Skel className="h-4 w-2/3" />
                  <Skel className="h-4 w-20" />
                  <Skel className="h-5 w-16 rounded-md" />
                </div>
              ))}
            {shown.map((r) => (
              <div
                key={r.user.id}
                onClick={() => router.push(`/staff/${r.user.id}`)}
                className={cx("grid cursor-pointer items-center gap-3 border-b border-line2 px-4 py-2.5 transition-colors last:border-0 hover:bg-hover", cols)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className={cx("truncate text-[13.5px] font-medium", r.status !== "aktif" && "text-muted")}>{r.user.name}</span>
                  <span className="tnum text-xs text-muted">{r.user.employee_code}</span>
                </span>
                <span>
                  <Tag tone={tipe(r.user.employment_type)} />
                </span>
                <span>
                  <Pill tone={EMP_STATUS[r.status]} />
                </span>
              </div>
            ))}
          </div>
        </div>
        {staff.isSuccess && rows.length === 0 && <Empty />}
        <Pager page={cur} total={rows.length} perPage={PER_PAGE} onPage={setPage} />
      </Card>

      <AdminDetailDrawer user={viewHead ? account(viewHead) : null} onClose={() => setViewHead(null)} />
      {modal === "edit" && <UnitForm unit={unit} onClose={() => setModal(null)} />}
      {modal === "delete" && <DeleteUnitModal unit={unit} onClose={() => setModal(null)} onDeleted={() => router.push("/units")} />}
    </Page>
  );
}
