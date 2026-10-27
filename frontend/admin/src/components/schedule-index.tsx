import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { shiftTone, tipe, toneStyle } from "@/lib/status";
import type { ScheduleIndexRow } from "@/lib/types";
import { Button, Card, Empty, ErrorState, Pager, SearchBox, Select, SelectBox, Skel, SortHead, Tag, useSort, cx } from "./ui";

const PER_PAGE = 20;


/** Tab Daftar: jadwal yang berlaku per karyawan, pilih banyak lalu Atur jadwal. */
export function ScheduleIndex({ unit, canEdit, onAssign }: { unit: string | null; canEdit: boolean; onAssign: (ids: number[]) => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<number[]>([]);
  const list = useQuery({
    queryKey: ["schedule-index", unit],
    queryFn: () => api<ScheduleIndexRow[]>("/api/v1/admin/schedule/index", { query: { unit: unit ?? undefined } }),
    enabled: !!unit,
  });
  const k = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((r) => (!k || r.name.toLowerCase().includes(k) || r.employee_code.toLowerCase().includes(k)) && (kind === "all" || r.kind === kind));
  const { sorted, sort, toggle: sortBy } = useSort(rows, {
    name: (r) => r.name,
    schedule: (r) => r.schedule,
    start: (r) => r.start_date,
    next: (r) => (r.next_shift ? `${r.next_shift.date} ${r.next_shift.start_time}` : null),
  });
  const maxPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const shown = sorted.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);
  const cols = canEdit ? "grid-cols-[20px_minmax(0,1.8fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_72px]" : "grid-cols-[minmax(0,1.8fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.5fr)]";
  const allIds = rows.map((r) => r.user_id);
  const allOn = allIds.length > 0 && allIds.every((id) => sel.includes(id));

  if (list.isError) return <ErrorState message={(list.error as Error).message} onRetry={() => list.refetch()} />;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        {sel.length > 0 ? (
          <>
            <span className="tnum text-[13px] font-medium">{sel.length} karyawan dipilih</span>
            <Button size="sm" onClick={() => onAssign(sel)}>
              Atur jadwal
            </Button>
            <button onClick={() => setSel([])} className="h-8 px-2 text-[13px] text-muted hover:text-ink">
              Batal
            </button>
          </>
        ) : (
          <>
            <SearchBox value={q} onChange={(v) => (setQ(v), setPage(0))} placeholder="Cari nama atau NIK" className="sm:w-auto sm:flex-1" />
            <Select
              className="w-[170px] flex-none"
              value={kind}
              onChange={(v) => (setKind(v), setPage(0))}
              options={[
                { value: "all", label: "Semua jadwal" },
                { value: "pola", label: "Pola jadwal" },
                { value: "fleksibel", label: "Fleksibel" },
                { value: "manual", label: "Manual" },
              ]}
            />
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={cx("grid items-center gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", cols)}>
            {canEdit && <SelectBox on={allOn} some={!allOn && sel.length > 0} label="Pilih semua" onClick={() => setSel(allOn ? [] : allIds)} />}
            <SortHead label="Nama" k="name" sort={sort} onSort={sortBy} />
            <SortHead label="Jadwal" k="schedule" sort={sort} onSort={sortBy} />
            <SortHead label="Berlaku" k="start" sort={sort} onSort={sortBy} />
            <SortHead label="Shift berikutnya" k="next" sort={sort} onSort={sortBy} />
            {canEdit && <span />}
          </div>
          {list.isLoading &&
            [...Array(5)].map((_, i) => (
              <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", cols)}>
                {canEdit && <span />}
                <Skel className="h-4 w-2/3" />
                <Skel className="h-4 w-1/2" />
                <Skel className="h-4 w-2/3" />
                <Skel className="h-5 w-24 rounded-md" />
                {canEdit && <span />}
              </div>
            ))}
          {shown.map((r) => {
            const on = sel.includes(r.user_id);
            const ns = r.next_shift;
            const t = ns ? shiftTone(ns.name, ns.color) : null;
            return (
              <div key={r.user_id} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-2.5 last:border-0", on && "bg-brand-soft/40", cols)}>
                {canEdit && <SelectBox on={on} label={`Pilih ${r.name}`} onClick={() => setSel(on ? sel.filter((x) => x !== r.user_id) : [...sel, r.user_id])} />}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-medium">{r.name}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="tnum text-xs text-muted">{r.employee_code}</span>
                    <Tag tone={tipe(r.employment_type)} className="px-1.5 py-0 text-[11px]" />
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cx("truncate text-[13px]", r.kind === "manual" ? "text-muted" : "font-medium")}>{r.schedule}</span>
                  {r.kind === "fleksibel" && <span className="rounded bg-warn-bg px-1.5 py-px text-[11px] font-medium text-warn">Fleksibel</span>}
                </span>
                <span className="tnum truncate text-[13px] text-muted">{r.start_date ? `${fmtDate(r.start_date)} – ${r.end_date ? fmtDate(r.end_date) : "seterusnya"}` : "—"}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {ns && t ? (
                    <>
                      <span className="tnum flex h-6 flex-none items-center rounded-md px-2 text-xs font-semibold" style={toneStyle(t.bg, t.fg)}>
                        {ns.name} {ns.start_time}–{ns.end_time}
                      </span>
                      <span className="tnum truncate text-xs text-muted">{fmtDate(ns.date)}</span>
                    </>
                  ) : (
                    <span className="text-[13px] text-warn">Belum dijadwalkan</span>
                  )}
                </span>
                {canEdit && (
                  <button onClick={() => onAssign([r.user_id])} className="h-8 rounded-lg border border-line px-2.5 text-[12.5px] font-medium hover:bg-soft">
                    Atur
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {list.isSuccess && rows.length === 0 && <Empty />}
      <Pager page={cur} total={rows.length} perPage={PER_PAGE} onPage={setPage} />
    </Card>
  );
}
