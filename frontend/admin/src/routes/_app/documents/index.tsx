import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Folder, PencilLine, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmployeeFilesTab } from "@/components/employee-files";
import { useRefreshFiles, wibDay } from "@/components/files";
import { FolderForm, DeleteFolderModal, audienceLabel } from "@/components/folder-form";
import { PillTabs } from "@/components/pill-tabs";
import { useToast } from "@/components/providers";
import { RowMenu } from "@/components/row-menu";
import { Page } from "@/components/shell";
import { ConfirmModal } from "@/components/staff-form";
import { Button, Card, cx, Empty, ErrorState, FormRow, inputCls, Modal, ModalHead, PageHeader, SearchBox, Skel, SortHead, useSort } from "@/components/ui";
import { api, errMsg } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useRouter } from "@/lib/nav";
import { useSession } from "@/lib/session";
import type { FileCategory, FolderOut } from "@/lib/types";

export const Route = createFileRoute("/_app/documents/")({ component: DocumentsPage });

type Tab = "company" | "employees" | "categories";

function DocumentsPage() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>("company");
  const [form, setForm] = useState<{ folder: FolderOut | null } | null>(null);
  const [catForm, setCatForm] = useState<{ cat: FileCategory | null } | null>(null);
  const folders = useQuery({ queryKey: ["folders"], queryFn: () => api<FolderOut[]>("/api/v1/admin/folders") });
  const cats = useQuery({ queryKey: ["file-categories"], queryFn: () => api<FileCategory[]>("/api/v1/admin/file-categories"), enabled: s.can.manageFiles });
  const manage = s.can.manageFiles;
  return (
    <Page>
      <PageHeader
        left={
          <PillTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "company", label: "File perusahaan", count: folders.data?.length },
              { value: "employees", label: "File karyawan" },
              ...(manage ? [{ value: "categories" as const, label: "Kategori", count: cats.data?.length }] : []),
            ]}
          />
        }
        action={
          manage &&
          (tab === "company" ? (
            <Button onClick={() => setForm({ folder: null })}>
              <Plus size={15} /> Folder baru
            </Button>
          ) : tab === "categories" ? (
            <Button onClick={() => setCatForm({ cat: null })}>
              <Plus size={15} /> Kategori baru
            </Button>
          ) : null)
        }
      />
      {tab === "company" && <FolderTable q={folders} manage={manage} onEdit={(f) => setForm({ folder: f })} />}
      {tab === "employees" && <EmployeeFilesTab />}
      {tab === "categories" && <CategoryTable q={cats} onEdit={(c) => setCatForm({ cat: c })} />}
      {form && <FolderForm folder={form.folder} onClose={() => setForm(null)} />}
      {catForm && <CategoryForm cat={catForm.cat} onClose={() => setCatForm(null)} />}
    </Page>
  );
}

const COLS = "grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_110px_64px_110px_48px]";

function FolderTable({ q, manage, onEdit }: { q: ReturnType<typeof useQuery<FolderOut[]>>; manage: boolean; onEdit: (f: FolderOut) => void }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [del, setDel] = useState<FolderOut | null>(null);
  const k = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((f) => !k || f.name.toLowerCase().includes(k));
  const { sorted, sort, toggle } = useSort(rows, { name: (f) => f.name, from: (f) => f.available_from, count: (f) => f.file_count, updated: (f) => f.updated_at });
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  return (
    <Card>
      <div className="border-b border-line p-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Cari folder" className="sm:w-full" />
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className={cx("grid gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", COLS)}>
            <SortHead label="Folder" k="name" sort={sort} onSort={toggle} />
            <span>Penerima</span>
            <SortHead label="Tampil mulai" k="from" sort={sort} onSort={toggle} />
            <SortHead label="File" k="count" sort={sort} onSort={toggle} align="right" />
            <SortHead label="Diperbarui" k="updated" sort={sort} onSort={toggle} />
            <span />
          </div>
          {q.isLoading &&
            [...Array(4)].map((_, i) => (
              <div key={i} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-3", COLS)}>
                <Skel className="h-4 w-1/2" />
                <Skel className="h-4 w-2/3" />
                <Skel className="h-4 w-16" />
                <Skel className="ml-auto h-4 w-6" />
                <Skel className="h-4 w-16" />
                <span />
              </div>
            ))}
          {sorted.map((f) => (
            <div key={f.id} onClick={() => router.push(`/documents/${f.id}`)} className={cx("grid cursor-pointer items-center gap-3 border-b border-line2 px-4 py-2.5 transition-colors last:border-0 hover:bg-hover", COLS)}>
              <span className="flex min-w-0 items-center gap-2.5">
                <Folder size={18} className="flex-none text-brand" />
                <span className="truncate text-[13.5px] font-medium">{f.name}</span>
              </span>
              <span className="truncate text-[13px] text-muted">{audienceLabel(f)}</span>
              <span className="tnum text-[13px] text-muted">{f.available_from ? fmtDate(f.available_from) : "—"}</span>
              <span className="tnum text-right text-[13px] text-muted">{f.file_count}</span>
              <span className="tnum text-[13px] text-muted">{fmtDate(wibDay(f.updated_at))}</span>
              <span onClick={(e) => e.stopPropagation()}>
                {manage && (
                  <RowMenu
                    actions={[
                      { label: "Ubah", icon: <PencilLine size={15} />, onClick: () => onEdit(f) },
                      { label: "Hapus", icon: <Trash2 size={15} />, danger: true, onClick: () => setDel(f) },
                    ]}
                  />
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      {q.isSuccess && rows.length === 0 && <Empty title={k ? "Folder tidak ditemukan" : "Belum ada folder"} />}
      {del && <DeleteFolderModal folder={del} onClose={() => setDel(null)} />}
    </Card>
  );
}

const CAT_COLS = "grid-cols-[minmax(0,1fr)_96px_48px]";

function CategoryTable({ q, onEdit }: { q: ReturnType<typeof useQuery<FileCategory[]>>; onEdit: (c: FileCategory) => void }) {
  const toast = useToast();
  const refresh = useRefreshFiles();
  const [del, setDel] = useState<FileCategory | null>(null);
  const remove = useMutation({
    mutationFn: (c: FileCategory) => api(`/api/v1/admin/file-categories/${c.id}`, { method: "DELETE" }),
    onSuccess: () => (refresh(), toast("Kategori dihapus"), setDel(null)),
    onError: (e) => (toast(errMsg(e)), setDel(null)),
  });
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  return (
    <Card>
      <div className={cx("grid gap-3 border-b border-line bg-soft/60 px-4 py-2 text-xs font-medium text-muted", CAT_COLS)}>
        <span>Kategori</span>
        <span className="text-right">File</span>
        <span />
      </div>
      {q.isLoading && <Skel className="m-4 h-4 w-1/3" />}
      {(q.data ?? []).map((c) => (
        <div key={c.id} className={cx("grid items-center gap-3 border-b border-line2 px-4 py-2.5 last:border-0", CAT_COLS)}>
          <span className="truncate text-[13.5px] font-medium">{c.name}</span>
          <span className="tnum text-right text-[13px] text-muted">{c.file_count}</span>
          <RowMenu
            actions={[
              { label: "Ubah", icon: <PencilLine size={15} />, onClick: () => onEdit(c) },
              { label: "Hapus", icon: <Trash2 size={15} />, danger: true, onClick: () => setDel(c) },
            ]}
          />
        </div>
      ))}
      {q.isSuccess && q.data.length === 0 && <Empty title="Belum ada kategori" />}
      {del && (
        <ConfirmModal
          title={`Hapus kategori ${del.name}?`}
          body={del.file_count ? `Kategori ini masih dipakai ${del.file_count} file. Pindahkan filenya dulu.` : "Kategori akan dihapus dari daftar."}
          confirm="Hapus"
          danger
          loading={remove.isPending}
          onConfirm={() => remove.mutate(del)}
          onClose={() => setDel(null)}
        />
      )}
    </Card>
  );
}

function CategoryForm({ cat, onClose }: { cat: FileCategory | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshFiles();
  const [name, setName] = useState(cat?.name ?? "");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => (cat ? api(`/api/v1/admin/file-categories/${cat.id}`, { method: "PUT", body: { name: name.trim() } }) : api("/api/v1/admin/file-categories", { body: { name: name.trim() } })),
    onSuccess: () => (refresh(), toast(cat ? "Kategori disimpan" : "Kategori ditambahkan"), onClose()),
    onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose}>
      <ModalHead title={cat ? "Ubah kategori" : "Kategori baru"} onClose={onClose} />
      <FormRow label="Nama kategori" required>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Sertifikat BLS" className={inputCls} />
      </FormRow>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate()}>
          Simpan
        </Button>
      </div>
    </Modal>
  );
}

