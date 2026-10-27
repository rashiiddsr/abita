import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CalendarClock, Folder, PencilLine, Trash2, Upload, Users } from "lucide-react";
import { useState } from "react";
import { FileList, UploadModal, useRefreshFiles } from "@/components/files";
import { audienceLabel, DeleteFolderModal, FolderForm } from "@/components/folder-form";
import { Page, useCrumb } from "@/components/shell";
import { Button, Card, ErrorState, Skel } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, todayWib } from "@/lib/format";
import { useParams, useRouter } from "@/lib/nav";
import { useSession } from "@/lib/session";
import type { FileOut, FolderOut } from "@/lib/types";

export const Route = createFileRoute("/_app/documents/$id")({ component: FolderPage });

function FolderPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const s = useSession();
  const refresh = useRefreshFiles();
  const [dialog, setDialog] = useState<"upload" | "edit" | "delete" | null>(null);
  const folder = useQuery({ queryKey: ["folder", id], queryFn: () => api<FolderOut>(`/api/v1/admin/folders/${id}`) });
  const files = useQuery({ queryKey: ["folder-files", id], queryFn: () => api<FileOut[]>(`/api/v1/admin/folders/${id}/files`) });
  const manage = s.can.manageFiles;
  useCrumb(folder.data?.name);
  const back = null;
  if (folder.isError)
    return (
      <Page>
        {back}
        <ErrorState message={(folder.error as Error).message} onRetry={() => folder.refetch()} />
      </Page>
    );
  const f = folder.data;
  const pending = f?.available_from && f.available_from > todayWib();
  return (
    <Page>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {back}
        {manage && f && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog("edit")}>
              <PencilLine size={16} /> Ubah
            </Button>
            <Button variant="dangerOutline" onClick={() => setDialog("delete")}>
              <Trash2 size={16} /> Hapus
            </Button>
            <Button onClick={() => setDialog("upload")}>
              <Upload size={16} /> Unggah file
            </Button>
          </div>
        )}
      </div>
      {!f ? (
        <Skel className="h-24 rounded-xl" />
      ) : (
        <Card className="flex items-start gap-4 px-[22px] py-5">
          <span className="flex size-12 flex-none items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Folder size={22} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-lg font-semibold">{f.name}</span>
            {f.description && <span className="text-[13.5px] text-muted">{f.description}</span>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
              <span className="flex items-center gap-1.5">
                <Users size={14} /> {audienceLabel(f)}
              </span>
              {f.available_from && (
                <span className={`flex items-center gap-1.5 ${pending ? "text-warn" : ""}`}>
                  <CalendarClock size={14} /> {pending ? "Tampil mulai" : "Tampil sejak"} {fmtDate(f.available_from)}
                </span>
              )}
              {f.reminder_date && (
                <span className="flex items-center gap-1.5" title={f.reminder_message ?? undefined}>
                  <BellRing size={14} /> Pengingat {fmtDate(f.reminder_date)}
                  {f.reminder_sent ? " · terkirim" : ""}
                </span>
              )}
            </div>
          </div>
        </Card>
      )}
      <Card>
        <FileList files={files.data} loading={files.isLoading} manage={manage} onChanged={refresh} />
      </Card>
      {dialog === "upload" && <UploadModal path={`/api/v1/admin/folders/${id}/files`} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "edit" && f && <FolderForm folder={f} onClose={() => setDialog(null)} />}
      {dialog === "delete" && f && <DeleteFolderModal folder={f} onClose={() => setDialog(null)} onDeleted={() => router.push("/documents")} />}
    </Page>
  );
}
