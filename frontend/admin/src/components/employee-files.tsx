/** Tab "File karyawan" di menu Dokumen: semua file karyawan dalam jangkauan, rekap Excel, unduh ZIP, unggah massal per folder. */
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FolderUp, X } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { FileCategory, FileOut, StaffRow } from "@/lib/types";
import { ACCEPT, FileIcon, FileList, fmtSize, saveFromApi, useRefreshFiles } from "./files";
import { useToast } from "./providers";
import { Button, Card, Checkbox, cx, IconBtn, Modal, ModalHead, Pager, SearchBox, Select } from "./ui";

const PER_PAGE = 25;

export function EmployeeFilesTab() {
  const s = useSession();
  const refresh = useRefreshFiles();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [unitSel, setUnit] = useState("all");
  const [page, setPage] = useState(0);
  const [bulk, setBulk] = useState(false);
  const unit = s.lockedUnit ?? (unitSel === "all" ? undefined : unitSel);
  const category = cat === "all" ? undefined : cat;
  const list = useQuery({ queryKey: ["employee-files", unit, category], queryFn: () => api<FileOut[]>("/api/v1/admin/files", { query: { unit, category_id: category } }) });
  const cats = useQuery({ queryKey: ["file-categories"], queryFn: () => api<FileCategory[]>("/api/v1/admin/file-categories") });
  const k = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((f) => !k || `${f.name}${f.ext} ${f.owner?.name ?? ""} ${f.owner?.employee_code ?? ""}`.toLowerCase().includes(k));
  const maxPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  const cur = Math.min(page, maxPage);
  const qs = new URLSearchParams(Object.entries({ unit, category_id: category }).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(0))} placeholder="Cari file, nama, atau NIK" className="min-w-[220px] flex-1" />
        <Select
          className="w-[180px] flex-none"
          value={cat}
          onChange={(v) => (setCat(v), setPage(0))}
          options={[{ value: "all", label: "Semua kategori" }, ...(cats.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))]}
        />
        {!s.lockedUnit && (
          <Select
            className="w-[180px] flex-none"
            value={unitSel}
            onChange={(v) => (setUnit(v), setPage(0))}
            options={[{ value: "all", label: "Semua unit" }, ...s.units.map((u) => ({ value: u.name, label: u.name }))]}
          />
        )}
        <Button variant="outline" onClick={() => saveFromApi(`/api/v1/admin/files/report${unit ? `?unit=${encodeURIComponent(unit)}` : ""}`)}>
          <FileSpreadsheet size={15} /> Rekap Excel
        </Button>
        <Button variant="outline" disabled={!list.data?.length} onClick={() => saveFromApi(`/api/v1/admin/files/export${qs ? `?${qs}` : ""}`)}>
          <Download size={15} /> Unduh ZIP
        </Button>
        {s.can.manageFiles && (
          <Button onClick={() => setBulk(true)}>
            <FolderUp size={15} /> Unggah massal
          </Button>
        )}
      </div>
      <FileList files={rows.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE)} loading={list.isLoading} manage={s.can.manageFiles} showOwner showCategory categories={cats.data} onChanged={refresh} />
      <Pager page={cur} total={rows.length} perPage={PER_PAGE} onPage={setPage} />
      {bulk && cats.data && <BulkUploadModal categories={cats.data} onClose={() => setBulk(false)} onDone={refresh} />}
    </Card>
  );
}

// ------------------------------------------------------------------ unggah massal

const MAX_FILES = 300;
const MAX_MB = 10;
const BATCH = 10;
const KNOWN_EXT = new Set(ACCEPT.split(","));
const extOf = (name: string) => (name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
/** Bandingkan nama tanpa beda huruf/tanda baca: "STR _ SIP" (dari ZIP ekspor) = "STR / SIP". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Row = { key: string; file: File; path: string; userId: number | null; categoryId: number | null };

/** Isi folder yang ditarik ke dialog (FileSystemEntry), beserta path relatifnya. */
async function readEntry(entry: FileSystemEntry, prefix = ""): Promise<[File, string][]> {
  if (entry.isFile) return new Promise((ok) => (entry as FileSystemFileEntry).file((f) => ok([[f, prefix + entry.name]]), () => ok([])));
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok) => reader.readEntries(ok, () => ok([])));
    if (!batch.length) break;
    all.push(...batch);
  }
  return (await Promise.all(all.map((e) => readEntry(e, `${prefix}${entry.name}/`)))).flat();
}

/**
 * Struktur folder: NIK / Kategori / file (folder NIK boleh "NIK - Nama", seperti hasil Unduh ZIP).
 * Karyawan & kategori dicocokkan otomatis; yang tidak cocok dipilih manual sebelum diunggah.
 */
function BulkUploadModal({ categories, onClose, onDone }: { categories: FileCategory[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [drag, setDrag] = useState(false);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const staff = useQuery({ queryKey: ["staff", undefined], queryFn: () => api<StaffRow[]>("/api/v1/admin/staff") });
  const people = useMemo(() => (staff.data ?? []).map((r) => r.user).filter((u) => u.role === "staff"), [staff.data]);
  const byNik = useMemo(() => new Map(people.map((u) => [u.employee_code, u])), [people]);
  const byCat = useMemo(() => new Map(categories.map((c) => [norm(c.name), c.id])), [categories]);

  const add = (items: [File, string][]) => {
    let skip = 0;
    const next = [...rows];
    for (const [file, path] of items) {
      const segs = path.split("/").filter(Boolean);
      if (file.name.startsWith(".") || /^thumbs\.db$/i.test(file.name) || !KNOWN_EXT.has(extOf(file.name)) || file.size > MAX_MB * 1024 * 1024) {
        skip++;
        continue;
      }
      // folder NIK: segmen (selain nama file) yang diawali NIK karyawan; kategori = folder sesudahnya
      const dirs = segs.slice(0, -1);
      const at = dirs.findIndex((d) => byNik.has(d.match(/^\d+/)?.[0] ?? ""));
      const user = at >= 0 ? byNik.get(dirs[at].match(/^\d+/)![0]) : undefined;
      const catDir = at >= 0 ? dirs[at + 1] : dirs.at(-1);
      const key = `${path}|${file.size}`;
      if (next.some((r) => r.key === key)) continue;
      next.push({ key, file, path, userId: user?.id ?? null, categoryId: catDir ? (byCat.get(norm(catDir)) ?? null) : null });
    }
    if (next.length > MAX_FILES) return setErr(`Maksimal ${MAX_FILES} file sekali unggah.`);
    setErr(null);
    setSkipped(skipped + skip);
    setRows(next);
  };
  const pick = (list: FileList | null) => add(Array.from(list ?? []).map((f) => [f, f.webkitRelativePath || f.name]));
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const entries = Array.from(e.dataTransfer.items)
      .map((i) => i.webkitGetAsEntry())
      .filter((x): x is FileSystemEntry => !!x);
    add((await Promise.all(entries.map((x) => readEntry(x)))).flat());
  };
  const set = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const incomplete = rows.filter((r) => r.userId === null || r.categoryId === null).length;

  async function upload() {
    if (!rows.length) return setErr("Pilih folder lebih dulu.");
    if (incomplete) return setErr(`${incomplete} file belum punya karyawan atau kategori.`);
    // satu permintaan per karyawan + kategori, maks. 10 file
    const groups = new Map<string, Row[]>();
    for (const r of rows) groups.set(`${r.userId}|${r.categoryId}`, [...(groups.get(`${r.userId}|${r.categoryId}`) ?? []), r]);
    const batches = [...groups.values()].flatMap((g) => Array.from({ length: Math.ceil(g.length / BATCH) }, (_, i) => g.slice(i * BATCH, (i + 1) * BATCH)));
    const failed: Row[] = [];
    const errors: string[] = [];
    let done = 0;
    setBusy({ done, total: rows.length });
    for (const b of batches) {
      const fd = new FormData();
      fd.append("category_id", String(b[0].categoryId));
      fd.append("notify", String(notify));
      for (const r of b) fd.append("files", r.file, r.file.name);
      try {
        await api(`/api/v1/admin/staff/${b[0].userId}/files`, { body: fd });
      } catch (e) {
        failed.push(...b);
        errors.push(errMsg(e));
      }
      done += b.length;
      setBusy({ done, total: rows.length });
    }
    setBusy(null);
    onDone();
    if (!failed.length) {
      toast(`${rows.length} file diunggah`);
      return onClose();
    }
    setRows(failed);
    setErr(`${failed.length} file gagal: ${[...new Set(errors)].join(" ")}`);
  }

  const userOptions = [{ value: "", label: "Pilih karyawan" }, ...people.map((u) => ({ value: String(u.id), label: `${u.name} (${u.employee_code})` }))];
  const catOptions = [{ value: "", label: "Pilih kategori" }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))];
  return (
    <Modal open onClose={busy ? () => undefined : onClose} width={760} top={60}>
      <ModalHead title="Unggah massal file karyawan" onClose={busy ? () => undefined : onClose} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx("flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors", drag ? "border-brand bg-brand-soft" : "border-off hover:bg-soft")}
      >
        <FolderUp size={22} className="text-brand" />
        <span className="text-[13.5px] font-medium">Tarik folder ke sini atau pilih folder</span>
        <span className="text-xs text-faint">Struktur: NIK / Kategori / file · maks. {MAX_MB} MB per file</span>
      </button>
      {/* @ts-expect-error webkitdirectory belum ada di tipe React */}
      <input ref={input} type="file" webkitdirectory="" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-medium">{rows.length} file</span>
            {incomplete > 0 && <span className="text-warn">· {incomplete} perlu dilengkapi</span>}
            {skipped > 0 && <span className="text-muted">· {skipped} dilewati (format/ukuran)</span>}
          </div>
          <div className="max-h-[340px] overflow-y-auto rounded-lg border border-line">
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_32px] items-center gap-2 border-b border-line2 px-3 py-2 last:border-0">
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileIcon ext={extOf(r.file.name)} size={28} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px]">{r.file.name}</span>
                    <span className="truncate text-[11.5px] text-faint">
                      {r.path} · {fmtSize(r.file.size)}
                    </span>
                  </span>
                </span>
                <Select className={cx(r.userId === null && "ring-1 ring-warn")} value={r.userId === null ? "" : String(r.userId)} onChange={(v) => set(r.key, { userId: v ? Number(v) : null })} options={userOptions} />
                <Select className={cx(r.categoryId === null && "ring-1 ring-warn")} value={r.categoryId === null ? "" : String(r.categoryId)} onChange={(v) => set(r.key, { categoryId: v ? Number(v) : null })} options={catOptions} />
                <IconBtn label="Hapus dari daftar" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  <X size={15} />
                </IconBtn>
              </div>
            ))}
          </div>
        </>
      )}
      <Checkbox on={notify} onChange={() => setNotify(!notify)}>
        Beri tahu karyawan
      </Checkbox>
      {err && <span className="text-[13px] text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!!busy} onClick={onClose}>
          Batal
        </Button>
        <Button data-submit loading={!!busy} disabled={!rows.length} onClick={upload}>
          {busy ? `Mengunggah ${busy.done}/${busy.total}` : `Unggah${rows.length ? ` ${rows.length} file` : ""}`}
        </Button>
      </div>
    </Modal>
  );
}
