import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileRow, FolderRow } from "../components/files";
import { SubPage } from "../components/shell";
import { Empty, ListGroup, SectionLabel, Segmented, Skel } from "../components/ui";
import { api } from "../lib/api";
import { useLocation, useNavigate } from "../lib/nav";
import type { FileOut, FolderOut } from "../lib/types";

type Tab = "company" | "mine";

export function DocumentsPage() {
  const nav = useNavigate();
  const search = useLocation().search as Record<string, string | undefined>;
  const [tab, setTab] = useState<Tab>(search.tab === "mine" ? "mine" : "company");
  const folders = useQuery({ queryKey: ["my-folders"], queryFn: () => api<FolderOut[]>("/me/folders") });
  const mine = useQuery({ queryKey: ["my-files"], queryFn: () => api<FileOut[]>("/me/files"), enabled: tab === "mine" });
  // file milik sendiri dikelompokkan per kategori
  const groups = new Map<string, FileOut[]>();
  for (const f of mine.data ?? []) {
    const k = f.category?.name ?? "Lainnya";
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const loading = (tab === "company" ? folders.isPending : mine.isPending) && <Skel className="mt-4 h-40" />;
  return (
    <SubPage title="Dokumen">
      <div className="pt-1">
        <Segmented
          value={tab}
          onChange={setTab}
          items={[
            { value: "company", label: "Perusahaan" },
            { value: "mine", label: "Milik saya" },
          ]}
        />
      </div>
      {loading}
      {tab === "company" &&
        folders.data &&
        (folders.data.length ? (
          <div className="mt-4">
            <ListGroup>
              {folders.data.map((f) => (
                <FolderRow key={f.id} f={f} onClick={() => nav(`/documents/${f.id}`)} />
              ))}
            </ListGroup>
          </div>
        ) : (
          <Empty title="Belum ada dokumen perusahaan" />
        ))}
      {tab === "mine" &&
        mine.data &&
        (mine.data.length ? (
          [...groups.keys()].sort().map((k) => (
            <div key={k}>
              <SectionLabel>{k}</SectionLabel>
              <ListGroup>
                {groups.get(k)!.map((f) => (
                  <FileRow key={f.id} f={f} />
                ))}
              </ListGroup>
            </div>
          ))
        ) : (
          <Empty title="Belum ada dokumen" />
        ))}
    </SubPage>
  );
}

export function DocumentFolderPage({ id }: { id: number }) {
  const folder = useQuery({ queryKey: ["my-folder", id], queryFn: () => api<FolderOut>(`/me/folders/${id}`) });
  const files = useQuery({ queryKey: ["my-folder-files", id], queryFn: () => api<FileOut[]>(`/me/folders/${id}/files`) });
  return (
    <SubPage title={folder.data?.name ?? "Folder"} back="/documents">
      {folder.data?.description && <p className="px-1 pb-1 text-[13.5px] text-muted">{folder.data.description}</p>}
      {folder.isError || files.isError ? (
        <Empty title="Folder tidak ditemukan" />
      ) : !files.data ? (
        <Skel className="mt-3 h-40" />
      ) : files.data.length ? (
        <div className="mt-3">
          <ListGroup>
            {files.data.map((f) => (
              <FileRow key={f.id} f={f} />
            ))}
          </ListGroup>
        </div>
      ) : (
        <Empty title="Belum ada file" />
      )}
    </SubPage>
  );
}
