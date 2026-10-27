/** Komponen dokumen bersama: ikon file, daftar file, unggah, ubah, hapus. Dipakai menu Dokumen dan tab Dokumen karyawan. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, File, FileImage, FileSpreadsheet, FileText, PencilLine, Presentation, Trash2, Upload, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { api, apiUrl, download, errMsg } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { toneStyle } from "@/lib/status";
import type { FileCategory, FileOut } from "@/lib/types";
import { useToast } from "./providers";
import { RowMenu } from "./row-menu";
import { ConfirmModal } from "./staff-form";
import { Button, Card, Checkbox, Chip, cx, Empty, FormRow, IconBtn, inputCls, Modal, ModalHead, Select, Skel } from "./ui";

export const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx";
const MAX_MB = 10;
const MAX_FILES = 10;

const KIND: Record<string, { icon: typeof File; bg: string; fg: string }> = {
  ".pdf": { icon: FileText, bg: "#FDECEC", fg: "#C82829" },
  ".jpg": { icon: FileImage, bg: "#ECEEFC", fg: "#4F5BD5" },
  ".jpeg": { icon: FileImage, bg: "#ECEEFC", fg: "#4F5BD5" },
  ".png": { icon: FileImage, bg: "#ECEEFC", fg: "#4F5BD5" },
  ".webp": { icon: FileImage, bg: "#ECEEFC", fg: "#4F5BD5" },
  ".docx": { icon: FileText, bg: "#E6EFFC", fg: "#2B5FB8" },
  ".xlsx": { icon: FileSpreadsheet, bg: "#E3F5EA", fg: "#14995A" },
  ".pptx": { icon: Presentation, bg: "#FDEEE3", fg: "#B4531A" },
};

const extOf = (name: string) => (name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();

export function FileIcon({ ext, size = 36 }: { ext: string; size?: number }) {
  const k = KIND[ext] ?? { icon: File, bg: "#F4F6F8", fg: "#5B6678" };
  return (
    <span className="flex flex-none items-center justify-center rounded-[10px] bg-[var(--tone-bg)] text-[var(--tone-fg)]" style={{ ...toneStyle(k.bg, k.fg), width: size, height: size }}>
      <k.icon size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Tanggal WIB dari waktu ISO (UTC). */
export const wibDay = (ts: string) => new Date(Date.parse(ts) + 7 * 3600_000).toISOString().slice(0, 10);

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export const openFile = (f: FileOut) => window.open(apiUrl(`/api/v1/files/${f.id}`), "_blank", "noopener");
export const downloadFile = (f: FileOut) => download(`/api/v1/files/${f.id}?download=1`, f.name + f.ext);

/** Unduhan besar (ZIP, Excel) langsung oleh browser: dialirkan dari server, tidak ditampung di memori halaman. */
export function saveFromApi(path: string) {
  const a = document.createElement("a");
  a.href = apiUrl(path);
  a.rel = "noopener";
  a.click();
}

/** Daftar file: klik baris membuka file (PDF/gambar) atau mengunduhnya (Office). */
export function FileList({
  files,
  loading,
  manage,
  showCategory,
  showOwner,
  categories,
  onChanged,
}: {
  files: FileOut[] | undefined;
  loading?: boolean;
  manage: boolean;
  showCategory?: boolean;
  showOwner?: boolean;
  categories?: FileCategory[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [edit, setEdit] = useState<FileOut | null>(null);
  const [del, setDel] = useState<FileOut | null>(null);
  const get = (f: FileOut) => (f.inline ? openFile(f) : downloadFile(f).catch((e) => toast(errMsg(e))));
  if (loading)
    return (
      <div className="flex flex-col">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line2 px-4 py-3 last:border-0">
            <Skel className="size-9 rounded-[10px]" />
            <Skel className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  if (!files?.length) return <Empty compact title="Belum ada file" />;
  return (
    <div className="flex flex-col">
      {files.map((f) => (
        <div key={f.id} onClick={() => get(f)} className="flex cursor-pointer items-center gap-3 border-b border-line2 px-4 py-2.5 transition-colors last:border-0 hover:bg-hover">
          <FileIcon ext={f.ext} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13.5px] font-medium">
              {f.name}
              <span className="text-faint">{f.ext}</span>
            </span>
            <span className="truncate text-xs text-muted">
              {showOwner && f.owner ? `${f.owner.name} (${f.owner.employee_code}) · ` : ""}
              {showCategory && f.category ? `${f.category.name} · ` : ""}
              {fmtSize(f.size)} · {fmtDate(wibDay(f.created_at))}
              {f.uploaded_by ? ` · ${f.uploaded_by}` : ""}
            </span>
          </span>
          <span onClick={(e) => e.stopPropagation()}>
            <RowMenu
              actions={[
                { label: "Buka", icon: <ExternalLink size={15} />, onClick: () => openFile(f), hidden: !f.inline },
                { label: "Unduh", icon: <Download size={15} />, onClick: () => void downloadFile(f).catch((e) => toast(errMsg(e))) },
                { label: "Ubah", icon: <PencilLine size={15} />, onClick: () => setEdit(f), hidden: !manage },
                { label: "Hapus", icon: <Trash2 size={15} />, danger: true, onClick: () => setDel(f), hidden: !manage },
              ]}
            />
          </span>
        </div>
      ))}
      {edit && <FileEditModal file={edit} categories={showCategory ? categories : undefined} onClose={() => setEdit(null)} onSaved={onChanged} />}
      {del && <DeleteFileModal file={del} onClose={() => setDel(null)} onDeleted={onChanged} />}
    </div>
  );
}

/** Unggah 1–10 file ke `path` (multipart `files`); `categories` = file karyawan (wajib pilih kategori). */
export function UploadModal({ path, categories, onClose, onDone }: { path: string; categories?: FileCategory[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<globalThis.File[]>([]);
  const [category, setCategory] = useState("");
  const [notify, setNotify] = useState(true);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = (list: FileList | null) => {
    const next = [...picked];
    for (const f of Array.from(list ?? [])) {
      if (!KIND[extOf(f.name)]) return setErr(`${f.name}: format tidak didukung.`);
      if (f.size > MAX_MB * 1024 * 1024) return setErr(`${f.name}: ukuran maksimal ${MAX_MB} MB.`);
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    if (next.length > MAX_FILES) return setErr(`Maksimal ${MAX_FILES} file sekali unggah.`);
    setErr(null);
    setPicked(next);
  };
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      if (categories) fd.append("category_id", category);
      fd.append("notify", String(notify));
      for (const f of picked) fd.append("files", f);
      return api<FileOut[]>(path, { body: fd });
    },
    onSuccess: (r) => {
      toast(`${r.length} file diunggah`);
      onDone();
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const submit = () => {
    if (categories && !category) return setErr("Pilih kategori.");
    if (!picked.length) return setErr("Pilih minimal satu file.");
    m.mutate();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
  };
  return (
    <Modal open onClose={onClose} width={500}>
      <ModalHead title="Unggah file" onClose={onClose} />
      {categories && (
        <FormRow label="Kategori" required>
          <Select big value={category} onChange={setCategory} options={[{ value: "", label: "Pilih kategori" }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]} />
        </FormRow>
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx("flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-7 text-center transition-colors", drag ? "border-brand bg-brand-soft" : "border-off hover:bg-soft")}
      >
        <Upload size={22} className="text-brand" />
        <span className="text-[13.5px] font-medium">Tarik file ke sini atau pilih file</span>
        <span className="text-xs text-faint">PDF, JPG, PNG, WEBP, DOCX, XLSX, PPTX · maks. {MAX_MB} MB</span>
      </button>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      {picked.length > 0 && (
        <div className="flex max-h-[240px] flex-col overflow-y-auto rounded-lg border border-line">
          {picked.map((f, i) => (
            <div key={f.name + f.size} className="flex items-center gap-3 border-b border-line2 px-3 py-2 last:border-0">
              <FileIcon ext={extOf(f.name)} size={30} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
              <span className="tnum text-xs text-muted">{fmtSize(f.size)}</span>
              <IconBtn label="Hapus dari daftar" onClick={() => setPicked(picked.filter((_, k) => k !== i))}>
                <X size={15} />
              </IconBtn>
            </div>
          ))}
        </div>
      )}
      <Checkbox on={notify} onChange={() => setNotify(!notify)}>
        Beri tahu karyawan
      </Checkbox>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={m.isPending} onClick={submit}>
          Unggah{picked.length ? ` ${picked.length} file` : ""}
        </Button>
      </div>
    </Modal>
  );
}

function FileEditModal({ file, categories, onClose, onSaved }: { file: FileOut; categories?: FileCategory[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(file.name);
  const [category, setCategory] = useState(file.category ? String(file.category.id) : "");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<FileOut>(`/api/v1/admin/files/${file.id}`, { method: "PUT", body: { name: name.trim(), category_id: categories ? Number(category) : undefined } }),
    onSuccess: () => {
      toast("File disimpan");
      onSaved();
      onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose}>
      <ModalHead title="Ubah file" onClose={onClose} />
      <FormRow label="Nama file" required>
        <div className="flex items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          <span className="text-[13px] text-muted">{file.ext}</span>
        </div>
      </FormRow>
      {categories && (
        <FormRow label="Kategori" required>
          <Select big value={category} onChange={setCategory} options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
        </FormRow>
      )}
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

function DeleteFileModal({ file, onClose, onDeleted }: { file: FileOut; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/api/v1/admin/files/${file.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast("File dihapus");
      onDeleted();
      onClose();
    },
    onError: (e) => (toast(errMsg(e)), onClose()),
  });
  return <ConfirmModal title={`Hapus ${file.name}${file.ext}?`} body="File akan dihapus permanen." confirm="Hapus" danger loading={m.isPending} onConfirm={() => m.mutate()} onClose={onClose} />;
}

/** Muat ulang semua daftar dokumen setelah perubahan. */
export function useRefreshFiles() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["folders", "folder", "folder-files", "staff-files", "employee-files", "file-categories"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Tab Dokumen di detail karyawan: saring per kategori; Admin SDM mengunggah. */
export function StaffFiles({ userId, manage }: { userId: number; manage: boolean }) {
  const refresh = useRefreshFiles();
  const [cat, setCat] = useState<number | null>(null);
  const [upload, setUpload] = useState(false);
  const files = useQuery({ queryKey: ["staff-files", userId], queryFn: () => api<FileOut[]>(`/api/v1/admin/staff/${userId}/files`) });
  const cats = useQuery({ queryKey: ["file-categories"], queryFn: () => api<FileCategory[]>("/api/v1/admin/file-categories") });
  const list = files.data ?? [];
  const used = (cats.data ?? []).filter((c) => list.some((f) => f.category?.id === c.id));
  const shown = cat === null ? list : list.filter((f) => f.category?.id === cat);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          <Chip active={cat === null} label="Semua" count={list.length} onClick={() => setCat(null)} />
          {used.map((c) => (
            <Chip key={c.id} active={cat === c.id} label={c.name} count={list.filter((f) => f.category?.id === c.id).length} onClick={() => setCat(c.id)} />
          ))}
        </div>
        {manage && (
          <Button size="sm" onClick={() => setUpload(true)}>
            <Upload size={15} /> Unggah file
          </Button>
        )}
      </div>
      <FileList files={shown} loading={files.isLoading} manage={manage} showCategory categories={cats.data} onChanged={refresh} />
      {upload && cats.data && <UploadModal path={`/api/v1/admin/staff/${userId}/files`} categories={cats.data} onClose={() => setUpload(false)} onDone={refresh} />}
    </Card>
  );
}
